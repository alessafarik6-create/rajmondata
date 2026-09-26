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
import { assertJobBelongsToCompany } from "@/lib/email-mailbox/job-access-server";
import { findOrCreateEmailAttachmentFolder } from "@/lib/email-mailbox/email-attachment-job-media-server";
import { loadEmailAccount } from "@/lib/email-mailbox/account-store";

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

  const jobMeta = await assertJobBelongsToCompany(db, companyId, jobId);
  if (!jobMeta.ok) {
    return NextResponse.json({ ok: false, error: jobMeta.error }, { status: jobMeta.status });
  }

  const { messageId } = await ctx.params;
  const access = await assertMessageAccess(db, companyId, messageId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const account = await loadEmailAccount(db, companyId, access.message.emailAccountId);
  const mailboxEmail = account?.email ?? null;
  const emailSubject = access.message.subject ?? null;

  const sharedFolder = await findOrCreateEmailAttachmentFolder({
    db,
    companyId,
    jobId,
    userId: perm.caller.uid,
    mailboxEmail,
  });

  const attachments = access.message.attachments ?? [];
  const results: {
    attachmentId: string;
    documentId?: string;
    duplicate?: boolean;
    error?: string;
    imageId?: string;
  }[] = [];
  const updatedAttachments: EmailMessageAttachmentMeta[] = attachments.map((a) => ({ ...a }));
  let attachmentsAssigned = 0;
  let skippedDuplicates = 0;
  let failed = 0;

  for (const attId of attachmentIds) {
    const att = attachments.find((a) => a.id === attId);
    if (!att || !att.storagePath) {
      failed += 1;
      results.push({ attachmentId: attId, error: "Příloha nemá uložený soubor." });
      continue;
    }

    if (
      att.linkedJobId === jobId &&
      att.linkedJobMediaImageId &&
      att.linkedFolderId === sharedFolder.folderId
    ) {
      skippedDuplicates += 1;
      results.push({
        attachmentId: attId,
        documentId: att.linkedDocumentId ?? undefined,
        duplicate: true,
        imageId: att.linkedJobMediaImageId,
      });
      continue;
    }

    try {
      const linked = await linkEmailAttachmentToJob({
        db,
        companyId,
        jobId,
        messageId,
        emailAccountId: access.message.emailAccountId,
        attachment: att,
        category,
        createdByUserId: perm.caller.uid,
        jobDisplayName: body.jobDisplayName ?? jobMeta.jobLabel,
        mailboxEmail,
        emailSubject,
        sharedFolder: { folderId: sharedFolder.folderId, folderName: sharedFolder.folderName },
      });

      results.push({
        attachmentId: attId,
        documentId: linked.documentId,
        duplicate: linked.duplicate,
        imageId: linked.imageId,
      });

      if (linked.duplicate) {
        skippedDuplicates += 1;
      } else {
        attachmentsAssigned += 1;
      }

      const idx = updatedAttachments.findIndex((a) => a.id === attId);
      if (idx >= 0) {
        updatedAttachments[idx] = {
          ...updatedAttachments[idx]!,
          linkedJobId: jobId,
          linkedJobLabel: linked.jobLabel,
          linkedFolderId: linked.folderId,
          linkedFolderName: linked.folderName,
          linkedJobMediaImageId: linked.imageId,
          linkedDocumentId: category === "invoice" ? linked.documentId : null,
          createdDocumentId: category === "invoice" ? linked.documentId : null,
          documentCategory: category,
          emailPlacement: {
            target: "job",
            jobId,
            jobLabel: linked.jobLabel,
            jobAttachmentRole:
              category === "invoice"
                ? "invoice"
                : category === "drawing"
                  ? "drawing"
                  : category === "photo"
                    ? "photo"
                    : category === "contract"
                      ? "contract"
                      : category === "order"
                        ? "order"
                        : "other",
            contentKind:
              category === "invoice"
                ? "ACCOUNTING_DOCUMENT"
                : category === "drawing"
                  ? "DRAWING"
                  : category === "photo"
                    ? "PHOTO"
                    : "OTHER",
            accountingDocumentId: category === "invoice" ? linked.documentId : null,
            classifiedAt: new Date().toISOString(),
          },
        };
      }
    } catch (e) {
      failed += 1;
      results.push({
        attachmentId: attId,
        error: e instanceof Error ? e.message : "Uložení selhalo.",
      });
    }
  }

  if (attachmentsAssigned === 0 && skippedDuplicates === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          failed > 0
            ? `Nepodařilo se uložit přílohy (${failed} chyb).`
            : "Žádná příloha nebyla přiřazena.",
        failed,
        results,
      },
      { status: 400 }
    );
  }

  await emailMessagesCol(db, companyId).doc(messageId).update({
    attachments: updatedAttachments,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (attachmentsAssigned > 0) {
    await appendEmailMessageTimeline(db, companyId, messageId, {
      kind: "attachment_linked_job",
      label: `Přílohy uloženy do fotodokumentace ${sharedFolder.folderName} (${attachmentsAssigned}×)`,
      userId: perm.caller.uid,
      metadata: {
        jobId,
        folderId: sharedFolder.folderId,
        attachmentIds,
        category,
        attachmentsAssigned,
      },
    });
  }

  const partial = failed > 0;

  return NextResponse.json({
    ok: true,
    success: attachmentsAssigned > 0,
    partial,
    jobId,
    jobNumber: jobMeta.jobNumber,
    jobName: jobMeta.jobName,
    jobLabel: jobMeta.jobLabel,
    folderId: sharedFolder.folderId,
    folderName: sharedFolder.folderName,
    attachmentsAssigned,
    skippedDuplicates,
    failed,
    results,
  });
}
