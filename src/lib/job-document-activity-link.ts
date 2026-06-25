/**
 * Deep link z dashboard aktivity / notifikace na konkrétní dokument ve fotodokumentaci zakázky.
 */

import type { CustomerActivityType } from "@/lib/customer-activity";

export type JobDocumentMediaType = "image" | "pdf" | "other";

export type JobDocumentActivityOpenMode = "notes" | "chat" | "annotate" | "preview";

export type JobMediaActivityFocus = {
  folderId: string;
  fileId: string;
  fileName: string;
  commentId?: string;
  documentType?: JobDocumentMediaType;
  open: JobDocumentActivityOpenMode;
};

export type JobDocumentActivityLinkInput = {
  organizationId: string;
  customerId?: string | null;
  jobId: string;
  documentId: string;
  folderId?: string | null;
  documentType?: JobDocumentMediaType | null;
  commentId?: string | null;
  fileName?: string | null;
  open?: JobDocumentActivityOpenMode;
  activityType?: CustomerActivityType;
};

export function inferJobDocumentOpenMode(
  activityType?: CustomerActivityType | string | null,
  documentType?: JobDocumentMediaType | null
): JobDocumentActivityOpenMode {
  const t = String(activityType ?? "");
  if (
    t === "customer_image_annotation" ||
    t === "customer_pdf_annotation" ||
    t === "customer_annotation_created" ||
    t === "customer_annotation_updated"
  ) {
    return "annotate";
  }
  if (
    t === "customer_media_changes_requested" ||
    t === "customer_media_review_comment" ||
    t === "customer_document_comment" ||
    t === "customer_note_added"
  ) {
    return "notes";
  }
  if (documentType === "pdf" || documentType === "image") {
    return "preview";
  }
  return "notes";
}

export function buildJobDocumentActivityLink(input: JobDocumentActivityLinkInput): string {
  const jobId = String(input.jobId ?? "").trim();
  if (!jobId) return "/portal/jobs";

  const params = new URLSearchParams();
  params.set("mediaSection", "1");
  params.set("mediaFileId", String(input.documentId ?? "").trim());
  const folderId = String(input.folderId ?? "").trim();
  if (folderId) params.set("mediaFolderId", folderId);
  const commentId = String(input.commentId ?? "").trim();
  if (commentId) params.set("mediaCommentId", commentId);
  const docType = String(input.documentType ?? "").trim();
  if (docType === "image" || docType === "pdf" || docType === "other") {
    params.set("mediaDocType", docType);
  }
  const fileName = String(input.fileName ?? "").trim();
  if (fileName) params.set("mediaFileName", fileName);
  const open = input.open ?? inferJobDocumentOpenMode(input.activityType, input.documentType ?? null);
  params.set("mediaOpen", open);

  return `/portal/jobs/${encodeURIComponent(jobId)}?${params.toString()}`;
}

export function parseJobMediaActivityFocus(
  searchParams: Pick<URLSearchParams, "get">
): JobMediaActivityFocus | null {
  const fileId = String(searchParams.get("mediaFileId") ?? "").trim();
  if (!fileId) return null;

  const openRaw = String(searchParams.get("mediaOpen") ?? "notes").trim();
  const open: JobDocumentActivityOpenMode =
    openRaw === "chat" ||
    openRaw === "annotate" ||
    openRaw === "preview" ||
    openRaw === "notes"
      ? openRaw
      : "notes";

  const docTypeRaw = String(searchParams.get("mediaDocType") ?? "").trim();
  const documentType: JobDocumentMediaType | undefined =
    docTypeRaw === "image" || docTypeRaw === "pdf" || docTypeRaw === "other"
      ? docTypeRaw
      : undefined;

  const commentId = String(searchParams.get("mediaCommentId") ?? "").trim();

  return {
    folderId: String(searchParams.get("mediaFolderId") ?? "").trim(),
    fileId,
    fileName: String(searchParams.get("mediaFileName") ?? "").trim(),
    commentId: commentId || undefined,
    documentType,
    open,
  };
}

export function shouldScrollToJobMediaSection(
  searchParams: Pick<URLSearchParams, "get">
): boolean {
  if (searchParams.get("mediaSection") === "1") return true;
  return parseJobMediaActivityFocus(searchParams) != null;
}

/** Sestaví odkaz z uložené aktivity (nová metadata + starý targetLink). */
export function resolveCustomerActivityOpenLink(
  activity: Record<string, unknown>
): string | null {
  const legacy = String(activity.targetLink ?? "").trim();
  const jobId = String(activity.jobId ?? "").trim();
  const organizationId = String(
    activity.organizationId ?? activity.companyId ?? ""
  ).trim();
  const documentId = String(
    activity.documentId ?? activity.targetId ?? ""
  ).trim();

  if (jobId && organizationId && documentId) {
    const folderId = String(activity.folderId ?? activity.mediaFolderId ?? "").trim();
    const commentId = String(activity.commentId ?? "").trim();
    const documentTypeRaw = String(activity.documentType ?? "").trim();
    const documentType =
      documentTypeRaw === "image" || documentTypeRaw === "pdf" || documentTypeRaw === "other"
        ? (documentTypeRaw as JobDocumentMediaType)
        : null;

    return buildJobDocumentActivityLink({
      organizationId,
      customerId:
        typeof activity.customerId === "string" ? activity.customerId : null,
      jobId,
      documentId,
      folderId: folderId || null,
      documentType,
      commentId: commentId || null,
      fileName:
        typeof activity.fileName === "string"
          ? activity.fileName
          : typeof activity.documentName === "string"
            ? activity.documentName
            : null,
      activityType:
        typeof activity.type === "string"
          ? (activity.type as CustomerActivityType)
          : undefined,
    });
  }

  if (legacy) return legacy;
  if (jobId) return `/portal/jobs/${encodeURIComponent(jobId)}`;
  return null;
}
