import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { assertJobBelongsToCompany } from "@/lib/email-mailbox/job-access-server";
import {
  findOrCreateEmailAttachmentFolder,
  importEmailAttachmentToJobMedia,
} from "@/lib/email-mailbox/email-attachment-job-media-server";
import { companyDocumentIdForEmailAttachment } from "@/lib/email-mailbox/attachment-job-link-server";
import {
  findExistingDocumentForEmailAttachment,
  patchEmailAttachmentDocumentMeta,
} from "@/lib/email-mailbox/email-attachment-document-server";
import type { EmailDocumentAssignmentTarget } from "@/lib/email-mailbox/email-document-assignment";
import {
  EMAIL_OVERHEAD_EXPENSE_CATEGORIES,
  emailDocumentAssignmentSummary,
} from "@/lib/email-mailbox/email-document-assignment";
import { loadEmailAccount } from "@/lib/email-mailbox/account-store";
import { appendEmailMessageTimeline } from "@/lib/email-mailbox/message-timeline";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ messageId: string }> };

type CreateBody = {
  companyId?: string;
  attachmentId?: string;
  analysisId?: string | null;
  assignmentTarget?: EmailDocumentAssignmentTarget;
  jobId?: string | null;
  jobName?: string | null;
  overheadExpenseCategory?: string | null;
  linkToJobMedia?: boolean;
  form?: {
    number?: string;
    entityName?: string;
    description?: string;
    date?: string;
    taxDate?: string;
    dueDate?: string;
    variableSymbol?: string;
    supplierIco?: string;
    supplierDic?: string;
    amountNet?: number;
    vatAmount?: number;
    amountGross?: number;
    vatRate?: number;
    currency?: "CZK" | "EUR";
    costCategory?: string;
    requiresPayment?: boolean;
    paymentMethod?: string;
  };
};

async function copyToDocumentStorage(
  srcPath: string,
  destPath: string
): Promise<{ fileUrl: string | null; storagePath: string }> {
  const bucket = getAdminStorageBucket();
  if (!bucket) return { fileUrl: null, storagePath: destPath };
  const src = srcPath.replace(/^\//, "");
  const dest = destPath.replace(/^\//, "");
  const srcFile = bucket.file(src);
  const destFile = bucket.file(dest);
  const [srcExists] = await srcFile.exists();
  if (srcExists) await srcFile.copy(destFile);
  const [meta] = await destFile.getMetadata();
  const rawToken = meta.metadata?.firebaseStorageDownloadTokens;
  const token =
    typeof rawToken === "string" ? rawToken.split(",")[0]?.trim() : null;
  let fileUrl: string | null = null;
  if (token) {
    const enc = encodeURIComponent(dest);
    fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
  }
  return { fileUrl, storagePath: dest };
}

function mapAssignmentType(target: EmailDocumentAssignmentTarget): string {
  switch (target) {
    case "job":
      return "job_cost";
    case "overhead":
      return "overhead";
    case "company":
      return "company";
    case "pending":
      return "pending_assignment";
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const perm = await verifyCompanyPortalMutation(request, "documents");
    if (!perm.ok) {
      return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
    }
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
    }

    let body: CreateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
    }

    const companyId = String(body.companyId ?? perm.caller.companyId).trim();
    const attachmentId = String(body.attachmentId ?? "").trim();
    const { messageId } = await ctx.params;
    const form = body.form ?? {};
    const target: EmailDocumentAssignmentTarget = body.assignmentTarget ?? "pending";

    if (companyId !== perm.caller.companyId) {
      return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
    }
    if (!attachmentId) {
      return NextResponse.json({ ok: false, error: "Chybí attachmentId." }, { status: 400 });
    }
    if (!String(form.number ?? "").trim() || !String(form.entityName ?? "").trim()) {
      return NextResponse.json(
        { ok: false, error: "Vyplňte číslo dokladu a dodavatele." },
        { status: 400 }
      );
    }

    const access = await assertMessageAccess(db, companyId, messageId, perm.caller.uid, "write");
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }
    if (!emailMailboxTenantOk(perm.caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
    }

    const attachments = access.message.attachments ?? [];
    const att = attachments.find((a) => a.id === attachmentId);
    if (!att?.storagePath) {
      return NextResponse.json({ ok: false, error: "Příloha nenalezena." }, { status: 404 });
    }

    const existing = await findExistingDocumentForEmailAttachment(
      db,
      companyId,
      messageId,
      attachmentId
    );
    if (existing.exists) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        documentId: existing.id,
        assignmentType: null,
      });
    }

    let jobId: string | null = target === "job" ? String(body.jobId ?? "").trim() || null : null;
    if (target === "job") {
      if (!jobId) {
        return NextResponse.json({ ok: false, error: "Vyberte zakázku." }, { status: 400 });
      }
      const jobCheck = await assertJobBelongsToCompany(db, companyId, jobId);
      if (!jobCheck.ok) {
        return NextResponse.json({ ok: false, error: jobCheck.error }, { status: jobCheck.status });
      }
    }

    let overheadCat = String(body.overheadExpenseCategory ?? "").trim();
    if (target === "overhead" && overheadCat) {
      if (
        !EMAIL_OVERHEAD_EXPENSE_CATEGORIES.includes(
          overheadCat as (typeof EMAIL_OVERHEAD_EXPENSE_CATEGORIES)[number]
        )
      ) {
        overheadCat = "other";
      }
    }

    const assignmentType = mapAssignmentType(target);
    const amountNet = Number(form.amountNet) || 0;
    const vatAmount = Number(form.vatAmount) || 0;
    const amountGross = Number(form.amountGross) || amountNet + vatAmount;
    const vatRate = Number(form.vatRate) || 0;
    const currency = form.currency === "EUR" ? "EUR" : "CZK";

    const documentId = companyDocumentIdForEmailAttachment(messageId, attachmentId);
    const safeName =
      att.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
    const destPath = `companies/${companyId}/documents/${documentId}/${safeName}`;
    const copied = await copyToDocumentStorage(att.storagePath, destPath);

    const account = await loadEmailAccount(db, companyId, access.message.emailAccountId);
    const fromLabel =
      String(access.message.from ?? "").trim() || account?.email || "e-mail";

    let folderId: string | null = null;
    let folderName: string | null = null;
    let imageId: string | null = null;
    let jobLabel = body.jobName ?? null;

    if (target === "job" && jobId && body.linkToJobMedia !== false) {
      const jobCheckMedia = await assertJobBelongsToCompany(db, companyId, jobId);
      if (!jobCheckMedia.ok) {
        return NextResponse.json(
          { ok: false, error: jobCheckMedia.error },
          { status: jobCheckMedia.status }
        );
      }
      jobLabel = jobLabel ?? jobCheckMedia.jobLabel;
      const sharedFolder = await findOrCreateEmailAttachmentFolder({
        db,
        companyId,
        jobId,
        userId: perm.caller.uid,
        mailboxEmail: account?.email ?? null,
      });
      folderId = sharedFolder.folderId;
      folderName = sharedFolder.folderName;
      const media = await importEmailAttachmentToJobMedia({
        db,
        companyId,
        jobId,
        jobDisplayName: jobLabel,
        folderId,
        folderName,
        messageId,
        emailAccountId: access.message.emailAccountId,
        attachment: att,
        createdByUserId: perm.caller.uid,
        mailboxEmail: account?.email ?? null,
        emailSubject: access.message.subject ?? null,
      });
      if (media.ok) {
        imageId = media.imageId;
      }
    }

    const summaryLabel = emailDocumentAssignmentSummary({
      target,
      jobLabel,
      overheadCategory:
        target === "overhead"
          ? (overheadCat as (typeof EMAIL_OVERHEAD_EXPENSE_CATEGORIES)[number]) || "other"
          : null,
    });

    await db
      .collection("companies")
      .doc(companyId)
      .collection("documents")
      .doc(documentId)
      .set({
        number: String(form.number).trim(),
        entityName: String(form.entityName).trim(),
        description: String(form.description ?? "").trim(),
        date: String(form.date ?? new Date().toISOString().slice(0, 10)),
        taxDate: form.taxDate?.trim() || null,
        dueDate: form.dueDate?.trim() || null,
        variableSymbol: form.variableSymbol?.trim() || null,
        supplierIco: form.supplierIco?.trim() || null,
        supplierDic: form.supplierDic?.trim() || null,
        type: "received",
        documentKind: "prijate",
        currency,
        amount: amountNet,
        amountNet,
        amountGross,
        vatAmount,
        vatRate,
        dphSazba: vatRate,
        vat: vatRate,
        castka: amountGross,
        amountCZK: currency === "CZK" ? amountGross : amountGross,
        castkaCZK: currency === "CZK" ? amountGross : amountGross,
        sDPH: true,
        organizationId: companyId,
        createdBy: perm.caller.uid,
        uploadedBy: perm.caller.uid,
        assignmentType,
        unassigned: target === "pending",
        classificationStatus: target === "pending" ? "pending" : "assigned",
        jobId,
        zakazkaId: jobId,
        jobName: target === "job" ? jobLabel : null,
        costCategory: form.costCategory ?? "other",
        expenseCategory:
          target === "overhead" ? overheadCat || "other" : form.costCategory ?? null,
        overheadExpenseCategory: target === "overhead" ? overheadCat || "other" : null,
        requiresPayment: Boolean(form.requiresPayment),
        paymentMethod: form.paymentMethod ?? null,
        fileUrl: copied.fileUrl,
        fileName: att.filename,
        mimeType: att.contentType,
        fileType: att.contentType,
        storagePath: copied.storagePath,
        source: "email-attachment",
        sourceType: "email",
        sourceId: messageId,
        sourceLabel: `E-mail od ${fromLabel}`,
        sourceEmailMessageId: messageId,
        sourceEmailId: messageId,
        sourceAttachmentId: attachmentId,
        emailMessageId: messageId,
        emailAttachmentId: attachmentId,
        emailAccountId: access.message.emailAccountId,
        emailAnalysisId: body.analysisId ?? att.aiDocumentAnalysisId ?? null,
        folderId,
        jobMediaFolderId: folderId,
        jobMediaImageId: imageId,
        isDeleted: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    const nextAttachments = patchEmailAttachmentDocumentMeta(attachments, attachmentId, {
      linkedDocumentId: documentId,
      createdDocumentId: documentId,
      createdDocumentType: target === "job" ? "job_cost" : target,
      documentAssignmentLabel: summaryLabel,
      analysisStatus: "saved",
      linkedJobId: target === "job" ? jobId : att.linkedJobId ?? null,
      linkedJobLabel: target === "job" ? jobLabel : att.linkedJobLabel ?? null,
      linkedFolderId: folderId ?? att.linkedFolderId ?? null,
      linkedFolderName: folderName ?? att.linkedFolderName ?? null,
      linkedJobMediaImageId: imageId ?? att.linkedJobMediaImageId ?? null,
    });

    await emailMessagesCol(db, companyId).doc(messageId).update({
      attachments: nextAttachments as EmailMessageAttachmentMeta[],
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendEmailMessageTimeline(db, companyId, messageId, {
      kind: "attachment_document_created",
      label: `Příloha zařazena mezi doklady (${summaryLabel})`,
      userId: perm.caller.uid,
      metadata: { attachmentId, documentId, assignmentType, jobId },
    });

    await db.collection("companies").doc(companyId).collection("activityLogs").add({
      organizationId: companyId,
      companyId,
      userId: perm.caller.uid,
      actionType:
        target === "job"
          ? "DOCUMENT_ASSIGNED_TO_JOB"
          : target === "overhead"
            ? "DOCUMENT_CREATED_AS_OVERHEAD"
            : "DOCUMENT_CREATED_FROM_EMAIL",
      actionLabel: "EMAIL_ATTACHMENT_DOCUMENT",
      entityType: "document",
      entityId: documentId,
      metadata: { messageId, attachmentId, jobId, target },
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      documentId,
      assignmentType,
      jobId,
      assignmentLabel: summaryLabel,
    });
  } catch (err) {
    console.error("[email/create-document-from-attachment]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Uložení dokladu se nezdařilo." },
      { status: 500 }
    );
  }
}
