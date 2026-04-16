import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  callerCanTriggerOrgNotifications,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  DOCUMENT_EMAIL_TYPES,
  type DocumentEmailType,
  hasNonEmptyTextSubjectAndBody,
  isValidEmailAddress,
  normalizeEmailBodyToHtml,
  parseCommaSeparatedEmails,
  stripHtmlToPlain,
} from "@/lib/document-email-outbound";
import { sendDocumentEmail } from "@/lib/document-email-outbound-admin";
import { getDocumentPdfBuffer } from "@/lib/document-email-pdf-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const ROUTE_LOG = "[document-email/send]";

type Body = {
  companyId?: string;
  jobId?: string;
  type?: string;
  to?: string;
  cc?: string;
  subject?: string;
  html?: string;
  documentUrl?: string | null;
  invoiceId?: string | null;
  contractId?: string | null;
};

function isDocEmailType(s: string): s is DocumentEmailType {
  return (DOCUMENT_EMAIL_TYPES as readonly string[]).includes(s);
}

function summarizeBody(body: Body): Record<string, unknown> {
  const html = String(body.html ?? "");
  return {
    companyId: body.companyId,
    jobId: body.jobId,
    type: body.type,
    to: body.to != null ? String(body.to).slice(0, 3) + "…" : null,
    ccLen: String(body.cc ?? "").length,
    subjectLen: String(body.subject ?? "").length,
    htmlLen: html.length,
    documentUrlLen: body.documentUrl != null ? String(body.documentUrl).length : 0,
    invoiceId: body.invoiceId,
    contractId: body.contractId,
  };
}

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
  }
  if (!callerCanTriggerOrgNotifications(caller)) {
    return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch (parseErr) {
    console.error(ROUTE_LOG, "JSON parse failed", parseErr);
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  console.info(ROUTE_LOG, "payload summary", summarizeBody(body), {
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV,
    runtime: "nodejs",
  });

  const companyId = String(body.companyId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  const type = String(body.type ?? "").trim();
  const to = String(body.to ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const html = String(body.html ?? "").trim();
  const contractId = body.contractId != null ? String(body.contractId).trim() || null : null;
  const invoiceId = body.invoiceId != null ? String(body.invoiceId).trim() || null : null;

  if (!companyId || !jobId || !type || !to) {
    return NextResponse.json({ ok: false, error: "Chybí povinná pole." }, { status: 400 });
  }
  if (!callerCanAccessCompany(caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Nemáte přístup k organizaci." }, { status: 403 });
  }
  if (!isDocEmailType(type)) {
    return NextResponse.json({ ok: false, error: "Neplatný typ dokumentu." }, { status: 400 });
  }
  if (!isValidEmailAddress(to)) {
    return NextResponse.json({ ok: false, error: "Neplatná e-mailová adresa příjemce." }, { status: 400 });
  }
  const plainFromHtml = stripHtmlToPlain(html);
  if (!hasNonEmptyTextSubjectAndBody({ subject, bodyPlain: plainFromHtml })) {
    return NextResponse.json(
      { ok: false, error: "Vyplňte předmět i text zprávy." },
      { status: 400 }
    );
  }

  if (type === "contract" && !contractId) {
    return NextResponse.json({ ok: false, error: "Chybí identifikátor smlouvy." }, { status: 400 });
  }
  if ((type === "invoice" || type === "advance_invoice") && !invoiceId) {
    return NextResponse.json({ ok: false, error: "Chybí identifikátor dokladu." }, { status: 400 });
  }

  const jobRef = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  console.info(ROUTE_LOG, "job lookup", {
    companyId,
    jobId,
    jobExists: jobSnap.exists,
    jobName: jobSnap.exists ? String((jobSnap.data() as { name?: string })?.name ?? "").slice(0, 80) : null,
  });
  if (!jobSnap.exists) {
    return NextResponse.json({ ok: false, error: "Zakázka nenalezena." }, { status: 404 });
  }

  const ccExtra = parseCommaSeparatedEmails(String(body.cc ?? ""));
  for (const addr of ccExtra) {
    if (!isValidEmailAddress(addr)) {
      return NextResponse.json(
        { ok: false, error: `Neplatná adresa v kopii (CC): ${addr}` },
        { status: 400 }
      );
    }
  }

  let sentByEmail: string | null = null;
  try {
    const u = await auth.getUser(caller.uid);
    sentByEmail = String(u.email ?? "").trim() || null;
  } catch {
    sentByEmail = null;
  }

  console.info(ROUTE_LOG, "pdf generation start", { type, contractId, invoiceId });
  let pdf: Awaited<ReturnType<typeof getDocumentPdfBuffer>>;
  try {
    pdf = await getDocumentPdfBuffer({
      db,
      companyId,
      jobId,
      type,
      contractId,
      invoiceId,
    });
  } catch (pdfErr) {
    const e = pdfErr instanceof Error ? pdfErr : new Error(String(pdfErr));
    console.error(ROUTE_LOG, "getDocumentPdfBuffer threw", {
      message: e.message,
      stack: e.stack,
    });
    return NextResponse.json(
      {
        ok: false,
        error: `PDF: ${e.message.slice(0, 500)}`,
      },
      { status: 400 }
    );
  }

  if (!pdf.ok) {
    console.error(ROUTE_LOG, "pdf generation failed (ok=false)", { error: pdf.error });
    return NextResponse.json({ ok: false, error: pdf.error }, { status: 400 });
  }

  console.info(ROUTE_LOG, "pdf ok", {
    filename: pdf.filename,
    bufferBytes: pdf.buffer.length,
  });

  const attachments = [
    {
      filename: pdf.filename,
      content: pdf.buffer,
      contentType: "application/pdf" as const,
    },
  ];

  const result = await sendDocumentEmail(db, {
    companyId,
    jobId,
    type,
    to,
    ccExtra,
    subject,
    html: html.includes("<") ? html : normalizeEmailBodyToHtml(plainFromHtml),
    documentUrl: body.documentUrl != null ? String(body.documentUrl) : null,
    userId: caller.uid,
    sentByEmail,
    invoiceId,
    contractId,
    attachments,
  });

  if (!result.ok) {
    console.error(ROUTE_LOG, "Resend failed", { error: result.error });
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  console.info(ROUTE_LOG, "email sent ok");
  return NextResponse.json({ ok: true });
}
