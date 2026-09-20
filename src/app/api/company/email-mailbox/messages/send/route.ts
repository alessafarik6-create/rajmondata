import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertEmailAccountAccess, assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { sendEmailFromAccount } from "@/lib/email-mailbox/send-service";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import {
  parseUploadFiles,
  resolveForwardEmailAttachments,
  resolveRajmondataEmailAttachments,
} from "@/lib/email-mailbox/outbound-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type SendPayload = {
  companyId?: string;
  accountId?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  replyToMessageId?: string;
  forwardFromMessageId?: string;
  forwardAttachmentIds?: string[];
  rajmondataJobId?: string;
  rajmondataAttachmentRefs?: unknown;
};

async function parseSendPayload(request: NextRequest): Promise<{
  body: SendPayload;
  uploadFiles: File[];
}> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const toRaw = String(form.get("to") ?? "");
    let to: string[] = [];
    try {
      to = JSON.parse(toRaw) as string[];
    } catch {
      to = toRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    }
    let forwardAttachmentIds: string[] = [];
    try {
      forwardAttachmentIds = JSON.parse(String(form.get("forwardAttachmentIds") ?? "[]")) as string[];
    } catch {
      forwardAttachmentIds = [];
    }
    let rajmondataAttachmentRefs: unknown = [];
    try {
      rajmondataAttachmentRefs = JSON.parse(String(form.get("rajmondataAttachmentRefs") ?? "[]"));
    } catch {
      rajmondataAttachmentRefs = [];
    }
    const body: SendPayload = {
      companyId: String(form.get("companyId") ?? ""),
      accountId: String(form.get("accountId") ?? ""),
      to,
      subject: String(form.get("subject") ?? ""),
      textBody: String(form.get("textBody") ?? ""),
      htmlBody: String(form.get("htmlBody") ?? "") || undefined,
      replyToMessageId: String(form.get("replyToMessageId") ?? "") || undefined,
      forwardFromMessageId: String(form.get("forwardFromMessageId") ?? "") || undefined,
      forwardAttachmentIds,
      rajmondataJobId: String(form.get("rajmondataJobId") ?? "") || undefined,
      rajmondataAttachmentRefs,
    };
    const uploadFiles = form
      .getAll("files")
      .filter((v): v is File => v instanceof File && v.size > 0);
    return { body, uploadFiles };
  }

  const body = (await request.json()) as SendPayload;
  return { body, uploadFiles: [] };
}

export async function POST(request: NextRequest) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  let parsed: { body: SendPayload; uploadFiles: File[] };
  try {
    parsed = await parseSendPayload(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const body = parsed.body;
  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const accountId = String(body.accountId ?? "").trim();
  const to = Array.isArray(body.to) ? body.to.map(String) : [];
  const subject = String(body.subject ?? "").trim();
  const textBody = String(body.textBody ?? "").trim();
  if (!accountId || !to.length || !subject || !textBody) {
    return NextResponse.json({ ok: false, error: "Vyplňte účet, příjemce, předmět a text." }, { status: 400 });
  }

  const accountAccess = await assertEmailAccountAccess(db, companyId, accountId, perm.caller.uid, "write");
  if (!accountAccess.ok) {
    return NextResponse.json({ ok: false, error: accountAccess.error }, { status: accountAccess.status });
  }
  const { isEmailAccountSyncable } = await import("@/lib/email-mailbox/account-default");
  if (!isEmailAccountSyncable(accountAccess.account)) {
    return NextResponse.json(
      { ok: false, error: "Z této schránky nelze odesílat — účet je odpojený." },
      { status: 400 }
    );
  }

  let replyToMessage = null;
  const replyId = body.replyToMessageId || body.forwardFromMessageId;
  if (replyId) {
    const msgAccess = await assertMessageAccess(db, companyId, replyId, perm.caller.uid, "read");
    if (!msgAccess.ok) {
      return NextResponse.json({ ok: false, error: msgAccess.error }, { status: msgAccess.status });
    }
    const d = msgAccess.message;
    replyToMessage = {
      messageId: d.messageId ?? null,
      references: d.references ?? [],
      subject: d.subject ?? "",
    };
  }

  try {
    const attachments = await parseUploadFiles(parsed.uploadFiles);
    if (body.forwardFromMessageId && body.forwardAttachmentIds?.length) {
      const fwd = await resolveForwardEmailAttachments(
        db,
        companyId,
        body.forwardFromMessageId,
        body.forwardAttachmentIds,
        perm.caller.uid
      );
      attachments.push(...fwd);
    }
    if (body.rajmondataJobId && body.rajmondataAttachmentRefs) {
      const raj = await resolveRajmondataEmailAttachments(
        db,
        companyId,
        body.rajmondataJobId,
        body.rajmondataAttachmentRefs
      );
      attachments.push(...raj);
    }

    const sent = await sendEmailFromAccount(db, companyId, accountId, {
      to,
      cc: body.cc,
      subject,
      textBody,
      htmlBody: body.htmlBody,
      replyToMessage,
      attachments: attachments.length ? attachments : undefined,
    });
    await logEmailMailboxAudit(db, companyId, {
      actionType: "email_sent",
      actionLabel: "Odeslán e-mail",
      userId: perm.caller.uid,
      entityId: sent.messageDocId,
      metadata: { to, subject, accountId, attachmentCount: attachments.length },
    });
    return NextResponse.json({ ok: true, ...sent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
