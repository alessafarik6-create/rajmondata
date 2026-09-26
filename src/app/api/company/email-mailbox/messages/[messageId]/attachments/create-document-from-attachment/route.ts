import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
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
import {
  buildPlacementStatusLines,
  companyDocTypeCreatesAccounting,
  jobRoleCreatesAccountingDocument,
  type EmailAttachmentContentKind,
  type EmailCompanyDocType,
  type EmailJobAttachmentRole,
  type EmailOverheadDocType,
} from "@/lib/email-mailbox/email-attachment-classification";
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
  updateExisting?: boolean;
  jobId?: string | null;
  jobName?: string | null;
  jobAttachmentRole?: EmailJobAttachmentRole | null;
  contentKind?: EmailAttachmentContentKind | null;
  companyDocType?: EmailCompanyDocType | null;
  overheadDocType?: EmailOverheadDocType | null;
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

function resolveCreatesAccounting(body: CreateBody, target: EmailDocumentAssignmentTarget): boolean {
  if (target === "overhead") return true;
  if (target === "pending") return true;
  if (target === "company") {
    return companyDocTypeCreatesAccounting(body.companyDocType ?? "other");
  }
  if (target === "job") {
    return jobRoleCreatesAccountingDocument(body.jobAttachmentRole ?? "other");
  }
  return false;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const emailPerm = await requireEmailMailboxWrite(request);
    if (!emailPerm.ok) {
      return NextResponse.json({ ok: false, error: emailPerm.error }, { status: emailPerm.status });
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

    const companyId = String(body.companyId ?? emailPerm.caller.companyId).trim();
    const attachmentId = String(body.attachmentId ?? "").trim();
    const { messageId } = await ctx.params;
    const form = body.form ?? {};
    const target: EmailDocumentAssignmentTarget = body.assignmentTarget ?? "pending";
    const updateExisting = body.updateExisting !== false;
    const createsAccounting = resolveCreatesAccounting(body, target);

    if (createsAccounting) {
      const docPerm = await verifyCompanyPortalMutation(request, "documents");
      if (!docPerm.ok) {
        return NextResponse.json({ ok: false, error: docPerm.error }, { status: docPerm.status });
      }
      if (docPerm.caller.companyId !== companyId) {
        return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
      }
    }

    if (companyId !== emailPerm.caller.companyId) {
      return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
    }
    if (!attachmentId) {
      return NextResponse.json({ ok: false, error: "Chybí attachmentId." }, { status: 400 });
    }

    const access = await assertMessageAccess(db, companyId, messageId, emailPerm.caller.uid, "write");
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }
    if (!emailMailboxTenantOk(emailPerm.caller, companyId)) {
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
    if (existing.exists && !updateExisting) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        documentId: existing.id,
        assignmentType: null,
      });
    }

    const numberFallback = String(form.number ?? att.filename).trim().slice(0, 120);
    const entityFallback = String(form.entityName ?? "Nezařazeno").trim();

    if (createsAccounting) {
      if (!numberFallback || !entityFallback) {
        return NextResponse.json(
          { ok: false, error: "Vyplňte číslo dokladu a dodavatele." },
          { status: 400 }
        );
      }
    }

    let jobId: string | null = target === "job" ? String(body.jobId ?? "").trim() || null : null;
    let jobLabel = body.jobName ?? null;
    if (target === "job") {
      if (!jobId) {
        return NextResponse.json({ ok: false, error: "Vyberte zakázku." }, { status: 400 });
      }
      const jobCheck = await assertJobBelongsToCompany(db, companyId, jobId);
      if (!jobCheck.ok) {
        return NextResponse.json({ ok: false, error: jobCheck.error }, { status: jobCheck.status });
      }
      jobLabel = jobLabel ?? jobCheck.jobLabel;
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
    const documentId = companyDocumentIdForEmailAttachment(messageId, attachmentId);
    const safeName =
      att.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";

    const account = await loadEmailAccount(db, companyId, access.message.emailAccountId);
    const fromLabel =
      String(access.message.from ?? "").trim() || account?.email || "e-mail";

    let folderId: string | null = null;
    let folderName: string | null = null;
    let imageId: string | null = null;
    let copied: { fileUrl: string | null; storagePath: string } | null = null;

    const jobRole = body.jobAttachmentRole ?? "other";
    const linkMedia =
      target === "job" && jobId && body.linkToJobMedia !== false;

    if (linkMedia && jobId) {
      const sharedFolder = await findOrCreateEmailAttachmentFolder({
        db,
        companyId,
        jobId,
        userId: emailPerm.caller.uid,
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
        createdByUserId: emailPerm.caller.uid,
        mailboxEmail: account?.email ?? null,
        emailSubject: access.message.subject ?? null,
      });
      if (media.ok) {
        imageId = media.imageId;
      }
    }

    let accountingDocumentId: string | null = null;

    if (createsAccounting) {
      const destPath = `companies/${companyId}/documents/${documentId}/${safeName}`;
      copied = await copyToDocumentStorage(att.storagePath, destPath);

      const amountNet = Number(form.amountNet) || 0;
      const vatAmount = Number(form.vatAmount) || 0;
      const amountGross = Number(form.amountGross) || amountNet + vatAmount;
      const vatRate = Number(form.vatRate) || 0;
      const currency = form.currency === "EUR" ? "EUR" : "CZK";

      await db
        .collection("companies")
        .doc(companyId)
        .collection("documents")
        .doc(documentId)
        .set(
          {
            number: numberFallback,
            entityName: entityFallback,
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
            createdBy: emailPerm.caller.uid,
            uploadedBy: emailPerm.caller.uid,
            assignmentType,
            unassigned: target === "pending",
            classificationStatus: target === "pending" ? "pending" : "assigned",
            jobId: target === "job" ? jobId : null,
            zakazkaId: target === "job" ? jobId : null,
            jobName: target === "job" ? jobLabel : null,
            costCategory: form.costCategory ?? "other",
            expenseCategory:
              target === "overhead" ? overheadCat || "other" : form.costCategory ?? null,
            overheadExpenseCategory: target === "overhead" ? overheadCat || "other" : null,
            overheadDocType: body.overheadDocType ?? null,
            companyDocType: body.companyDocType ?? null,
            emailContentKind: body.contentKind ?? "ACCOUNTING_DOCUMENT",
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
            updatedAt: FieldValue.serverTimestamp(),
            ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true }
        );
      accountingDocumentId = documentId;
    } else if (target === "company") {
      const destPath = `companies/${companyId}/documents/${documentId}/${safeName}`;
      copied = await copyToDocumentStorage(att.storagePath, destPath);
      await db
        .collection("companies")
        .doc(companyId)
        .collection("documents")
        .doc(documentId)
        .set(
          {
            number: numberFallback,
            entityName: entityFallback || att.filename,
            description: String(form.description ?? att.filename).trim(),
            date: String(form.date ?? new Date().toISOString().slice(0, 10)),
            type: "archived",
            documentKind: "other",
            assignmentType: "company",
            unassigned: false,
            classificationStatus: "assigned",
            jobId: null,
            companyDocType: body.companyDocType ?? "other",
            emailContentKind: body.contentKind ?? "OTHER",
            fileUrl: copied.fileUrl,
            fileName: att.filename,
            mimeType: att.contentType,
            storagePath: copied.storagePath,
            source: "email-attachment",
            sourceEmailMessageId: messageId,
            sourceAttachmentId: attachmentId,
            emailMessageId: messageId,
            emailAttachmentId: attachmentId,
            organizationId: companyId,
            isDeleted: false,
            updatedAt: FieldValue.serverTimestamp(),
            ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true }
        );
      accountingDocumentId = documentId;
    } else if (existing.exists && !createsAccounting) {
      await db
        .collection("companies")
        .doc(companyId)
        .collection("documents")
        .doc(existing.id)
        .set(
          {
            isDeleted: true,
            deletedReason: "email_placement_changed_non_accounting",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }

    const placement = buildPlacementStatusLines({
      target,
      jobLabel,
      jobAttachmentRole: target === "job" ? jobRole : null,
      overheadCategory: target === "overhead" ? overheadCat || "other" : null,
      overheadDocType: body.overheadDocType ?? null,
      companyDocType: body.companyDocType ?? null,
    });
    placement.jobId = target === "job" ? jobId : null;
    placement.accountingDocumentId = accountingDocumentId;

    const summaryLabel = emailDocumentAssignmentSummary({
      target,
      jobLabel,
      overheadCategory:
        target === "overhead"
          ? (overheadCat as (typeof EMAIL_OVERHEAD_EXPENSE_CATEGORIES)[number]) || "other"
          : null,
    });

    const nextAttachments = patchEmailAttachmentDocumentMeta(attachments, attachmentId, {
      linkedDocumentId: accountingDocumentId,
      createdDocumentId: accountingDocumentId,
      createdDocumentType: target === "job" ? (createsAccounting ? "job_cost" : "job_media") : target,
      documentAssignmentLabel: summaryLabel,
      analysisStatus: "saved",
      linkedJobId: target === "job" ? jobId : null,
      linkedJobLabel: target === "job" ? jobLabel : null,
      linkedFolderId: folderId ?? att.linkedFolderId ?? null,
      linkedFolderName: folderName ?? att.linkedFolderName ?? null,
      linkedJobMediaImageId: imageId ?? att.linkedJobMediaImageId ?? null,
      documentCategory:
        target === "job"
          ? jobRole === "invoice"
            ? "invoice"
            : jobRole === "drawing"
              ? "drawing"
              : "document"
          : att.documentCategory,
      emailPlacement: placement,
    });

    await emailMessagesCol(db, companyId).doc(messageId).update({
      attachments: nextAttachments as EmailMessageAttachmentMeta[],
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendEmailMessageTimeline(db, companyId, messageId, {
      kind: "attachment_document_created",
      label: `Příloha zařazena (${summaryLabel})`,
      userId: emailPerm.caller.uid,
      metadata: { attachmentId, documentId: accountingDocumentId, assignmentType, jobId },
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      documentId: accountingDocumentId,
      assignmentType,
      jobId,
      assignmentLabel: summaryLabel,
      emailPlacement: placement,
      openHref: accountingDocumentId
        ? `/portal/documents?documentId=${encodeURIComponent(accountingDocumentId)}`
        : jobId && folderId
          ? `/portal/jobs/${encodeURIComponent(jobId)}?mediaSection=1`
          : null,
    });
  } catch (err) {
    console.error("[email/create-document-from-attachment]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Uložení se nezdařilo." },
      { status: 500 }
    );
  }
}
