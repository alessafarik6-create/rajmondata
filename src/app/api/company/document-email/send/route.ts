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
import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";

export const dynamic = "force-dynamic";

type Body = {
  companyId?: string;
  jobId?: string;
  type?: string;
  to?: string;
  /** Volitelné ruční CC (čárkou), bez sloučení s nastavením — sloučení na serveru. */
  cc?: string;
  subject?: string;
  /** Odesílá se jako HTML (klient převádí z textarea). */
  html?: string;
  documentUrl?: string | null;
  invoiceId?: string | null;
  contractId?: string | null;
  /** PDF přílohy (base64), typicky jedna položka. */
  attachments?: unknown;
};

const MAX_PDF_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function parsePdfAttachments(raw: unknown): SendTransactionalEmailAttachment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SendTransactionalEmailAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const filename = String(o.filename ?? "").trim();
    const b64 = String(o.contentBase64 ?? "").trim();
    const contentType = String(o.contentType ?? "application/pdf").trim() || "application/pdf";
    if (!filename || !b64) return null;
    if (filename.length > 220 || /[/\\]/.test(filename)) return null;
    if (!filename.toLowerCase().endsWith(".pdf")) return null;
    if (contentType !== "application/pdf") return null;
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return null;
    }
    if (!buf.length || buf.length > MAX_PDF_ATTACHMENT_BYTES) return null;
    out.push({ filename, content: buf, contentType: "application/pdf" });
  }
  return out.length ? out : null;
}

function isDocEmailType(s: string): s is DocumentEmailType {
  return (DOCUMENT_EMAIL_TYPES as readonly string[]).includes(s);
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
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  const type = String(body.type ?? "").trim();
  const to = String(body.to ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const html = String(body.html ?? "").trim();

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

  const jobRef = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
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

  const attachments = parsePdfAttachments(body.attachments);
  if (!attachments) {
    return NextResponse.json(
      { ok: false, error: "Chybí platná PDF příloha (base64)." },
      { status: 400 }
    );
  }

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
    invoiceId: body.invoiceId != null ? String(body.invoiceId).trim() || null : null,
    contractId: body.contractId != null ? String(body.contractId).trim() || null : null,
    attachments,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
