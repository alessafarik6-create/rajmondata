/**
 * Import médií z jiné zakázky — typy a čisté pomůcky (klient + server).
 */

import {
  inferJobMediaItemType,
  type JobFolderType,
  type JobMediaFileType,
} from "@/lib/job-media-types";

export type JobMediaImportItemKind = "folderImage" | "legacyPhoto";

export type JobMediaImportCategory =
  | "documents"
  | "pdf"
  | "drawings"
  | "photo_doc"
  | "annotated";

export const JOB_MEDIA_IMPORT_CATEGORY_LABELS: Record<
  JobMediaImportCategory,
  string
> = {
  documents: "Dokumenty",
  pdf: "PDF",
  drawings: "Výkresy",
  photo_doc: "Fotodokumentace",
  annotated: "Anotované výkresy",
};

export type JobMediaImportListItem = {
  kind: JobMediaImportItemKind;
  id: string;
  folderId?: string;
  folderName?: string;
  folderType?: JobFolderType;
  fileName: string;
  fileType: JobMediaFileType;
  previewUrl: string;
  sizeBytes: number | null;
  createdAtMs: number | null;
  annotationCount: number;
  categories: JobMediaImportCategory[];
};

export type JobMediaImportSelectionRef = {
  kind: JobMediaImportItemKind;
  id: string;
  folderId?: string;
};

export type JobImportJobSearchRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  jobTag: string;
  customerName: string;
  addressLine: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  contractNumber: string;
};

function timestampToMs(t: unknown): number | null {
  if (!t) return null;
  if (typeof (t as { toMillis?: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (typeof (t as { toDate?: () => Date }).toDate === "function") {
    return (t as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof t === "number" && Number.isFinite(t)) return t;
  return null;
}

export function countJobMediaAnnotations(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const payload = raw as { items?: unknown };
  if (!Array.isArray(payload.items)) return 0;
  return payload.items.length;
}

export function classifyJobMediaImportCategories(params: {
  kind: JobMediaImportItemKind;
  folderType?: JobFolderType;
  fileType: JobMediaFileType;
  annotationCount: number;
  hasAnnotatedRaster: boolean;
}): JobMediaImportCategory[] {
  const cats = new Set<JobMediaImportCategory>();
  const { folderType, fileType, annotationCount, hasAnnotatedRaster, kind } =
    params;

  if (annotationCount > 0 || hasAnnotatedRaster) {
    cats.add("annotated");
  }

  if (fileType === "pdf") {
    cats.add("pdf");
  }

  if (kind === "legacyPhoto" || folderType === "photos") {
    cats.add("photo_doc");
  }

  if (fileType === "image" && (annotationCount > 0 || hasAnnotatedRaster)) {
    cats.add("drawings");
  } else if (
    fileType === "image" &&
    folderType !== "photos" &&
    kind !== "legacyPhoto"
  ) {
    cats.add("drawings");
  }

  if (folderType === "documents" || folderType === "files") {
    if (fileType !== "image" || folderType === "documents") {
      cats.add("documents");
    }
  }

  if (kind === "legacyPhoto" && fileType !== "pdf" && !cats.has("photo_doc")) {
    cats.add("photo_doc");
  }

  if (cats.size === 0) {
    cats.add("documents");
  }

  return Array.from(cats);
}

export function buildJobImportSearchRows(
  jobs: Record<string, unknown>[],
  customersById: Map<string, Record<string, unknown>>
): JobImportJobSearchRow[] {
  return jobs.map((j) => {
    const id = String(j.id ?? "").trim();
    const customerId = String(j.customerId ?? "").trim();
    const cust = customerId ? customersById.get(customerId) : undefined;
    const customerName = String(
      cust?.name ?? cust?.companyName ?? j.customerName ?? ""
    ).trim();
    const street = String(cust?.street ?? j.street ?? "").trim();
    const city = String(cust?.city ?? j.city ?? "").trim();
    const zip = String(cust?.zip ?? j.zip ?? "").trim();
    const addressLine = [street, [zip, city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    return {
      id,
      name: String(j.name ?? "").trim(),
      description: String(j.description ?? "").trim(),
      status: String(j.status ?? "").trim(),
      jobTag: String(j.jobTag ?? "").trim(),
      customerName,
      addressLine,
      createdAtMs: timestampToMs(j.createdAt),
      updatedAtMs: timestampToMs(j.updatedAt),
      contractNumber: String(j.contractNumber ?? j.jobNumber ?? "").trim(),
    };
  });
}

export function filterJobsForMediaImport(
  rows: JobImportJobSearchRow[],
  query: string,
  jobTagLabelFn?: (tag: string) => string
): JobImportJobSearchRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const dateStr =
      r.createdAtMs != null
        ? new Date(r.createdAtMs).toLocaleDateString("cs-CZ")
        : "";
    const updatedStr =
      r.updatedAtMs != null
        ? new Date(r.updatedAtMs).toLocaleDateString("cs-CZ")
        : "";
    const tagLabel =
      r.jobTag && jobTagLabelFn ? jobTagLabelFn(r.jobTag) : r.jobTag;
    const hay = [
      r.id,
      r.name,
      r.description,
      r.status,
      r.jobTag,
      tagLabel,
      r.customerName,
      r.addressLine,
      r.contractNumber,
      dateStr,
      updatedStr,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function listItemFromFirestoreRow(params: {
  kind: JobMediaImportItemKind;
  id: string;
  row: Record<string, unknown>;
  folderId?: string;
  folderName?: string;
  folderType?: JobFolderType;
}): JobMediaImportListItem {
  const row = params.row;
  const fileName =
    String(row.fileName ?? row.name ?? params.id).trim() || "soubor";
  const fileType = inferJobMediaItemType(row);
  const annotationCount = countJobMediaAnnotations(row.annotationData);
  const hasAnnotatedRaster =
    typeof row.annotatedImageUrl === "string" &&
    row.annotatedImageUrl.trim().length > 0;
  const previewUrl = String(
    row.annotatedImageUrl ??
      row.imageUrl ??
      row.url ??
      row.fileUrl ??
      row.downloadURL ??
      row.originalImageUrl ??
      ""
  ).trim();
  const sizeRaw = row.sizeBytes ?? row.fileSize ?? row.bytes;
  const sizeBytes =
    typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : null;
  const createdAtMs = timestampToMs(row.createdAt ?? row.uploadedAt);

  return {
    kind: params.kind,
    id: params.id,
    folderId: params.folderId,
    folderName: params.folderName,
    folderType: params.folderType,
    fileName,
    fileType,
    previewUrl,
    sizeBytes,
    createdAtMs,
    annotationCount,
    categories: classifyJobMediaImportCategories({
      kind: params.kind,
      folderType: params.folderType,
      fileType,
      annotationCount,
      hasAnnotatedRaster,
    }),
  };
}

export function formatImportFileSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
