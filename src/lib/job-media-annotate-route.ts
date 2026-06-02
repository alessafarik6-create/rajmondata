import type { JobPhotoAnnotationTarget } from "@/lib/job-media-types";

export function buildJobMediaAnnotateSearchParams(input: {
  target: Pick<JobPhotoAnnotationTarget, "id" | "fileType" | "annotationTarget">;
  canEdit: boolean;
}): URLSearchParams {
  const kind = input.target.annotationTarget?.kind;
  if (kind !== "folderImages" && kind !== "photos") {
    throw new Error("Invalid annotation target kind");
  }
  const id = String(input.target.id ?? "").trim();
  if (!id) {
    throw new Error("Missing media id");
  }
  const qs = new URLSearchParams();
  qs.set("kind", kind);
  qs.set("id", id);
  qs.set("fileType", input.target.fileType === "pdf" ? "pdf" : "image");
  const folderId =
    kind === "folderImages"
      ? String(input.target.annotationTarget?.folderId ?? "").trim()
      : "";
  if (folderId) qs.set("folderId", folderId);
  if (input.canEdit) qs.set("canEdit", "1");
  return qs;
}

export function buildEmployeeJobMediaAnnotateHref(
  jobId: string,
  target: JobPhotoAnnotationTarget,
  canEdit: boolean
): string {
  const qs = buildJobMediaAnnotateSearchParams({ target, canEdit });
  return `/portal/employee/jobs/${encodeURIComponent(jobId)}/annotate?${qs.toString()}`;
}

export function buildCustomerJobMediaAnnotateHref(
  jobId: string,
  target: JobPhotoAnnotationTarget,
  canEdit: boolean
): string {
  const qs = buildJobMediaAnnotateSearchParams({ target, canEdit });
  return `/portal/customer/jobs/${encodeURIComponent(jobId)}/annotate?${qs.toString()}`;
}
