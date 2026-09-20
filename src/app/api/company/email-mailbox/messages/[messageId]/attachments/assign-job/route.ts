import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import {
  EMAIL_ATTACHMENT_JOB_CATEGORIES,
  type EmailAttachmentJobCategory,
} from "@/lib/email-mailbox/attachment-meta";
import { linkEmailAttachmentToJob } from "@/lib/email-mailbox/attachment-job-link-server";
import { appendEmailMessageTimeline } from "@/lib/email-mailbox/message-timeline";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  let body: {
    companyId?: string;
    jobId?: string;
    attachmentIds?: string[];
    category?: string;
    jobDisplayName?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const jobId = String(body.jobId ?? "").trim();
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(String).filter(Boolean)
    : [];
  const category = (String(body.category ?? "document").trim() ||
    "document") as EmailAttachmentJobCategory;

  if (!jobId || !attachmentIds.length) {
    return NextResponse.json({ ok: false, error: "Vyberte zakázku a přílohu." }, { status: 400 });
  }
  if (!EMAIL_ATTACHMENT_JOB_CATEGORIES.includes(category)) {
    return NextResponse.json({ ok: false, error: "Neplatná kategorie." }, { status: 400 });
  }
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { messageId } = await ctx.params;
  const access = await assertMessageAccess(db, companyId, messageId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const attachments = access.message.attachments ?? [];
  const results: { attachmentId: string; documentId: string }[] = [];
  const updatedAttachments: EmailMessageAttachmentMeta[] = attachments.map((a) => ({ ...a }));

  for (const attId of attachmentIds) {
    const att = attachments.find((a) => a.id === attId);
    if (!att || !att.storagePath) continue;
    const linked = await linkEmailAttachmentToJob({
      db,
      companyId,
      jobId,
      messageId,
      emailAccountId: access.message.emailAccountId,
      attachment: att,
      category,
      createdByUserId: perm.caller.uid,
      jobDisplayName: body.jobDisplayName ?? null,
    });
    results.push({ attachmentId: attId, documentId: linked.documentId });
    const idx = updatedAttachments.findIndex((a) => a.id === attId);
    if (idx >= 0) {
      updatedAttachments[idx] = {
        ...updatedAttachments[idx]!,
        linkedJobId: jobId,
        linkedDocumentId: linked.documentId,
        documentCategory: category,
      };
    }
  }

  if (!results.length) {
    return NextResponse.json({ ok: false, error: "Žádná příloha nebyla přiřazena." }, { status: 400 });
  }

  await emailMessagesCol(db, companyId).doc(messageId).update({
    attachments: updatedAttachments,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await appendEmailMessageTimeline(db, companyId, messageId, {
    kind: "attachment_linked_job",
    label: `Příloha přiřazena k zakázce (${results.length}×)`,
    userId: perm.caller.uid,
    metadata: { jobId, attachmentIds, category },
  });

  return NextResponse.json({ ok: true, results });
}
