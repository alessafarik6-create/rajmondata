/**
 * Server (Admin SDK) — načtení šablony, odeslání, zápis historie odeslání dokumentů ze zakázky.
 *
 * Mapování na požadované helpery:
 * - `sendDocumentEmail(db, params)` — odeslání (Resend) + zápis do `documentEmailLogs`
 * - `getEmailTemplateFromCompany(db, companyId, type)` — šablona z `companies/{companyId}.documentEmailOutbound`
 * - `logDocumentSend(db, …)` — jen zápis záznamu (volá se z `sendDocumentEmail`)
 */

import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  type DocumentEmailOutboundSettings,
  type DocumentEmailType,
  getEmailTemplate,
  parseCommaSeparatedEmails,
  readDocumentEmailOutbound,
} from "@/lib/document-email-outbound";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";

export async function getEmailTemplateFromCompany(
  db: Firestore,
  companyId: string,
  type: DocumentEmailType
): Promise<{ subject: string; body: string }> {
  const snap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const outbound = readDocumentEmailOutbound(data);
  return getEmailTemplate(outbound, type);
}

function resolveCcList(params: {
  orgEmail: string | null;
  outbound: DocumentEmailOutboundSettings;
  userCc: string[];
  toLower: string;
}): string[] {
  const out: string[] = [];
  const add = (e: string) => {
    const x = e.trim().toLowerCase();
    if (x && x !== params.toLower) out.push(x);
  };
  for (const e of params.userCc) add(e);
  if (params.outbound.autoCcOrganizationEmail && params.orgEmail) {
    add(params.orgEmail);
  }
  for (const e of parseCommaSeparatedEmails(String(params.outbound.ccEmails ?? ""))) {
    add(e);
  }
  return [...new Set(out)];
}

export type SendDocumentEmailParams = {
  companyId: string;
  jobId: string;
  type: DocumentEmailType;
  to: string;
  /** Ruční kopie z modalu (mimo nastavení organizace). */
  ccExtra: string[];
  subject: string;
  html: string;
  documentUrl?: string | null;
  userId: string;
  sentByEmail?: string | null;
  invoiceId?: string | null;
  contractId?: string | null;
};

export async function logDocumentSend(
  db: Firestore,
  input: {
    companyId: string;
    jobId: string;
    type: DocumentEmailType;
    to: string;
    cc: string[];
    userId: string;
    /** Volitelně e-mail přihlášeného uživatele (pro zobrazení v historii). */
    sentByEmail?: string | null;
    subject: string;
    status: "sent" | "error";
    errorMessage?: string | null;
    documentUrl?: string | null;
    invoiceId?: string | null;
    contractId?: string | null;
  }
): Promise<string> {
  const col = db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("jobs")
    .doc(input.jobId)
    .collection("documentEmailLogs");
  const ref = await col.add({
    companyId: input.companyId,
    jobId: input.jobId,
    type: input.type,
    to: input.to.trim().toLowerCase(),
    cc: input.cc,
    subject: input.subject,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    documentUrl: input.documentUrl ?? null,
    invoiceId: input.invoiceId ?? null,
    contractId: input.contractId ?? null,
    sentByUid: input.userId,
    sentByEmail: input.sentByEmail != null ? String(input.sentByEmail).trim() || null : null,
    sentAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function sendDocumentEmail(
  db: Firestore,
  params: SendDocumentEmailParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(params.companyId).get();
  if (!companySnap.exists) {
    return { ok: false, error: "Organizace nenalezena." };
  }
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const outbound = readDocumentEmailOutbound(company);
  const orgEmailRaw = String(company.email ?? "").trim();
  const orgEmail = orgEmailRaw || null;

  const toNorm = params.to.trim().toLowerCase();
  const cc = resolveCcList({
    orgEmail,
    outbound,
    userCc: params.ccExtra.map((c) => c.trim().toLowerCase()).filter(Boolean),
    toLower: toNorm,
  });

  const send = await sendTransactionalEmail({
    to: [toNorm],
    cc: cc.length ? cc : undefined,
    subject: params.subject.trim(),
    html: params.html,
  });

  if (!send.ok) {
    await logDocumentSend(db, {
      companyId: params.companyId,
      jobId: params.jobId,
      type: params.type,
      to: params.to,
      cc,
      userId: params.userId,
      sentByEmail: params.sentByEmail ?? null,
      subject: params.subject,
      status: "error",
      errorMessage: send.error,
      documentUrl: params.documentUrl ?? null,
      invoiceId: params.invoiceId ?? null,
      contractId: params.contractId ?? null,
    });
    return send;
  }

  await logDocumentSend(db, {
    companyId: params.companyId,
    jobId: params.jobId,
    type: params.type,
    to: params.to,
    cc,
    userId: params.userId,
    sentByEmail: params.sentByEmail ?? null,
    subject: params.subject,
    status: "sent",
    documentUrl: params.documentUrl ?? null,
    invoiceId: params.invoiceId ?? null,
    contractId: params.contractId ?? null,
  });

  return { ok: true };
}
