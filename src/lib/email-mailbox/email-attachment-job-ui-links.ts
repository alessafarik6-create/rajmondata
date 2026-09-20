export function buildJobEmailAttachmentMediaUrl(
  jobId: string,
  folderId: string,
  imageId?: string | null
): string {
  const params = new URLSearchParams({ mediaSection: "1", mediaFolderId: folderId });
  if (imageId?.trim()) params.set("mediaFileId", imageId.trim());
  return `/portal/jobs/${encodeURIComponent(jobId)}?${params.toString()}`;
}

export function buildPortalEmailMessageUrl(messageId: string): string {
  return `/portal/email?messageId=${encodeURIComponent(messageId)}`;
}
