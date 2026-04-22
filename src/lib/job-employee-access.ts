/**
 * Oprávnění zaměstnanců u zakázky — čtení přes employeeSummary + jobMembers + viditelnost složek.
 */

import type { Firestore } from "firebase/firestore";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export const JOB_ROLE_ON_SITE_OPTIONS = [
  { value: "projektant", label: "Projektant" },
  { value: "delnik", label: "Dělník" },
  { value: "mistr", label: "Mistr" },
  { value: "montaznik", label: "Montážník" },
] as const;

export type JobRoleOnSite = (typeof JOB_ROLE_ON_SITE_OPTIONS)[number]["value"];

export type JobAccessMode = "limited" | "full_internal";

/** Granulární příznaky (rozšířitelné). */
export type JobMemberPermissions = {
  canViewJobOverview: boolean;
  canViewPhotoFolders: boolean;
  canViewBudgets: boolean;
  canViewDocuments: boolean;
  canUploadFiles: boolean;
  canCreateFolders: boolean;
  /** Prázdné = bez extra restrikce oproti příznakům složek */
  allowedFolderIds: string[];
  uploadFolderIds: string[];
};

export const DEFAULT_LIMITED_MEMBER_PERMISSIONS: JobMemberPermissions = {
  canViewJobOverview: true,
  canViewPhotoFolders: true,
  canViewBudgets: false,
  canViewDocuments: false,
  canUploadFiles: false,
  canCreateFolders: false,
  allowedFolderIds: [],
  uploadFolderIds: [],
};

export const DEFAULT_FULL_INTERNAL_MEMBER_PERMISSIONS: JobMemberPermissions = {
  canViewJobOverview: true,
  canViewPhotoFolders: true,
  canViewBudgets: true,
  canViewDocuments: true,
  canUploadFiles: true,
  canCreateFolders: true,
  allowedFolderIds: [],
  uploadFolderIds: [],
};

export function memberPermissionsForAccessMode(
  mode: JobAccessMode
): JobMemberPermissions {
  return mode === "full_internal"
    ? { ...DEFAULT_FULL_INTERNAL_MEMBER_PERMISSIONS }
    : { ...DEFAULT_LIMITED_MEMBER_PERMISSIONS };
}

export type JobMemberFirestoreDoc = {
  employeeId: string;
  authUserId?: string | null;
  roleOnJob?: JobRoleOnSite | string;
  accessMode: JobAccessMode;
  jobPermissions?: JobMemberPermissions;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
};

/** Bezpečný výpis pro kolekci employeeSummary/summary (žádné finance). */
export type JobEmployeeSummaryDoc = {
  jobId: string;
  companyId: string;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  customerPhone?: string | null;
  measuring?: string | null;
  measuringDetails?: string | null;
  jobTag?: string | null;
  /** Základní fotodokumentace — jen pokud true (výchozí ve významu interní = false) */
  legacyPhotosEmployeeVisible?: boolean;
  updatedAt?: unknown;
};

export function buildEmployeeSummaryPayload(
  companyId: string,
  jobId: string,
  job: Record<string, unknown>
): JobEmployeeSummaryDoc {
  return {
    jobId,
    companyId,
    name:
      typeof job.name === "string" && job.name.trim() ? job.name.trim() : null,
    description:
      typeof job.description === "string" && job.description.trim()
        ? job.description.trim()
        : null,
    status:
      typeof job.status === "string" && job.status.trim()
        ? job.status.trim()
        : null,
    startDate:
      typeof job.startDate === "string" && job.startDate.trim()
        ? job.startDate.trim()
        : null,
    endDate:
      typeof job.endDate === "string" && job.endDate.trim()
        ? job.endDate.trim()
        : null,
    customerName:
      typeof job.customerName === "string" && job.customerName.trim()
        ? job.customerName.trim()
        : null,
    customerAddress:
      typeof job.customerAddress === "string" && job.customerAddress.trim()
        ? job.customerAddress.trim()
        : null,
    customerPhone:
      typeof job.customerPhone === "string" && job.customerPhone.trim()
        ? job.customerPhone.trim()
        : null,
    measuring:
      typeof job.measuring === "string" && job.measuring.trim()
        ? job.measuring.trim()
        : null,
    measuringDetails:
      typeof job.measuringDetails === "string" &&
      job.measuringDetails.trim()
        ? job.measuringDetails.trim()
        : null,
    jobTag:
      typeof job.jobTag === "string" && job.jobTag.trim()
        ? job.jobTag.trim()
        : null,
    legacyPhotosEmployeeVisible:
      job.legacyPhotosEmployeeVisible === true,
    updatedAt: serverTimestamp(),
  };
}

const SUMMARY_DOC_ID = "summary";

export async function syncJobEmployeeSummary(
  firestore: Firestore,
  companyId: string,
  jobId: string,
  job: Record<string, unknown>
): Promise<void> {
  const ref = doc(
    firestore,
    "companies",
    companyId,
    "jobs",
    jobId,
    "employeeSummary",
    SUMMARY_DOC_ID
  );
  await setDoc(ref, buildEmployeeSummaryPayload(companyId, jobId, job), {
    merge: true,
  });
}

/** Složka je pro zaměstnance viditelná jen při explicitním příznaku. */
export function isFolderEmployeeVisible(folder: Record<string, unknown>): boolean {
  if (folder.employeeVisible === true) return true;
  if (folder.employeeVisibility === "employee_visible") return true;
  return false;
}

export function isFolderEmployeeUploadAllowed(
  folder: Record<string, unknown>
): boolean {
  if ((folder as { allowEmployeeUpload?: unknown }).allowEmployeeUpload === true) return true;
  /** Legacy (zpětná kompatibilita) */
  if ((folder as { employeeUploadAllowed?: unknown }).employeeUploadAllowed === true) return true;
  return false;
}

export function isImageEmployeeVisible(
  folder: Record<string, unknown> | null | undefined,
  image: Record<string, unknown>
): boolean {
  if ("employeeVisible" in image && image.employeeVisible === false) {
    return false;
  }
  if (image.employeeVisible === true) return true;
  return folder ? isFolderEmployeeVisible(folder) : false;
}

export function filterFoldersForLimitedEmployee(
  folders: Array<Record<string, unknown> & { id: string }>,
  permissions: JobMemberPermissions | null | undefined
): Array<Record<string, unknown> & { id: string }> {
  const allowed = permissions?.allowedFolderIds?.length
    ? new Set(permissions.allowedFolderIds)
    : null;
  return folders.filter((f) => {
    /** Účetní / dokladové složky nikdy neukazujeme v portálu zaměstnance. */
    if (f.type === "documents") return false;
    if (!isFolderEmployeeVisible(f)) return false;
    if (allowed && allowed.size > 0 && !allowed.has(f.id)) return false;
    if (permissions?.canViewPhotoFolders === false) return false;
    return true;
  });
}

export function canEmployeeUploadToFolder(
  folder: Record<string, unknown> & { id: string },
  permissions: JobMemberPermissions | null | undefined
): boolean {
  /** Upload zaměstnance řídíme primárně podle oprávnění složky + optional whitelistu uploadFolderIds. */
  if (!isFolderEmployeeVisible(folder)) return false;
  if (!isFolderEmployeeUploadAllowed(folder)) return false;
  const uploads = permissions?.uploadFolderIds;
  if (Array.isArray(uploads) && uploads.length > 0 && !uploads.includes(folder.id)) {
    return false;
  }
  return true;
}
