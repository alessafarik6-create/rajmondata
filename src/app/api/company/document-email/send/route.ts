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
};

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
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
