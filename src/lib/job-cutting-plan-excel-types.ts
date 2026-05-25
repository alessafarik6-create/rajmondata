/** Nářezový plánek — Excel navázaný na jednu zakázku (Firestore doc `current`). */

import type { CuttingPlanPreviewSnapshot } from "@/lib/job-cutting-plan-excel-preview";
import { parsePreviewFromJobDoc } from "@/lib/job-cutting-plan-excel-preview";

export type { CuttingPlanPreviewSnapshot } from "@/lib/job-cutting-plan-excel-preview";

export const CUTTING_PLAN_EXCEL_ACCEPT =
  ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

export const CUTTING_PLAN_EXCEL_MAX_BYTES = 20 * 1024 * 1024;

export type CuttingPlanExcelExtension = "xlsx" | "xls" | "csv";

export type JobCuttingPlanExcelDoc = {
  id: string;
  companyId: string;
  jobId: string;
  fileName: string;
  fileUrl: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  extension: CuttingPlanExcelExtension;
  uploadedBy: string;
  uploadedByName: string;
  uploadedByEmail?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  preview?: CuttingPlanPreviewSnapshot | null;
  previewUpdatedAt?: unknown;
  previewUpdatedBy?: string | null;
};

export const JOB_CUTTING_PLAN_EXCEL_DOC_ID = "current" as const;

export function inferCuttingPlanExtension(file: File): CuttingPlanExcelExtension | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".xls")) return "xls";
  if (name.endsWith(".csv")) return "csv";
  const t = (file.type || "").toLowerCase();
  if (t.includes("spreadsheetml") || t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }
  if (t.includes("ms-excel") || t === "application/vnd.ms-excel") return "xls";
  if (t === "text/csv" || t === "application/csv") return "csv";
  return null;
}

export function isAllowedCuttingPlanExcelFile(file: File): boolean {
  return inferCuttingPlanExtension(file) != null && file.size > 0 && file.size <= CUTTING_PLAN_EXCEL_MAX_BYTES;
}

export function formatCuttingPlanUploadedAt(value: unknown): string {
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toLocaleString("cs-CZ");
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toLocaleString("cs-CZ");
  }
  return "—";
}

export function parseJobCuttingPlanExcelDoc(
  raw: Record<string, unknown> | null | undefined,
  id: string
): JobCuttingPlanExcelDoc | null {
  if (!raw) return null;
  const fileName = String(raw.fileName ?? "").trim();
  const fileUrl = String(raw.fileUrl ?? "").trim();
  const storagePath = String(raw.storagePath ?? "").trim();
  if (!fileName || !fileUrl || !storagePath) return null;
  const ext = raw.extension;
  const extension: CuttingPlanExcelExtension =
    ext === "xls" || ext === "csv" || ext === "xlsx" ? ext : "xlsx";
  return {
    id,
    companyId: String(raw.companyId ?? ""),
    jobId: String(raw.jobId ?? ""),
    fileName,
    fileUrl,
    storagePath,
    mimeType: String(raw.mimeType ?? ""),
    fileSize: typeof raw.fileSize === "number" ? raw.fileSize : 0,
    extension,
    uploadedBy: String(raw.uploadedBy ?? ""),
    uploadedByName: String(raw.uploadedByName ?? "").trim() || "—",
    uploadedByEmail:
      typeof raw.uploadedByEmail === "string" ? raw.uploadedByEmail.trim() || null : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    preview: parsePreviewFromJobDoc(raw),
    previewUpdatedAt: raw.previewUpdatedAt,
    previewUpdatedBy:
      typeof raw.previewUpdatedBy === "string" ? raw.previewUpdatedBy : null,
  };
}
