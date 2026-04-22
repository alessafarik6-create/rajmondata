/**
 * Nastavení výrobního týmu u zakázky a bezpečný výřez dat pro zaměstnance.
 */

import {
  PRODUCTION_WORKFLOW_LABELS,
  parseProductionWorkflowStatus,
} from "@/lib/production-job-workflow";

export type ProductionCustomerDisplayMode = "show_customer" | "internal_only";

/** Režim evidence skladové položky (rozšíření oproti čistě kusovému skladu). */
export type StockTrackingMode = "pieces" | "length" | "area" | "mass" | "generic";

export const LENGTH_UNITS_MM = new Set(["mm", "millimeter", "millimetr"]);
export const LENGTH_UNITS_CM = new Set(["cm", "centimeter", "centimetr"]);
export const LENGTH_UNITS_M = new Set(["m", "meter", "metr", "mtr"]);

/** Převod na milimetry pro výpočty zásoby řeziva / profilů. */
export function lengthToMillimeters(value: number, unitRaw: string): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const u = String(unitRaw || "")
    .trim()
    .toLowerCase();
  if (LENGTH_UNITS_MM.has(u)) return value;
  if (LENGTH_UNITS_CM.has(u)) return value * 10;
  if (LENGTH_UNITS_M.has(u)) return value * 1000;
  return null;
}

export function millimetersToUnit(mm: number, unitRaw: string): number | null {
  const u = String(unitRaw || "")
    .trim()
    .toLowerCase();
  if (LENGTH_UNITS_MM.has(u)) return mm;
  if (LENGTH_UNITS_CM.has(u)) return mm / 10;
  if (LENGTH_UNITS_M.has(u)) return mm / 1000;
  return null;
}

export type JobProductionSettings = {
  /** ID dokumentů employees/{id} přiřazených k realizaci zakázky. */
  productionAssignedEmployeeIds: string[];
  /** Zda výrobní tým uvidí jméno zákazníka, nebo jen interní označení. */
  productionCustomerDisplayMode: ProductionCustomerDisplayMode;
  /** Interní název / kód zakázky pro výrobu (když se skrývá zákazník). */
  productionInternalLabel?: string | null;
  /** ID složek (jobs/.../folders/{id}) viditelných pro výrobní tým; prázdné = vše se značkou productionTeamVisible. */
  productionVisibleFolderIds?: string[];
  /** Volitelný textový stav výroby u zakázky (zobrazí se výrobnímu týmu). */
  productionStatusNote?: string | null;
};

export const DEFAULT_JOB_PRODUCTION_SETTINGS: JobProductionSettings = {
  productionAssignedEmployeeIds: [],
  productionCustomerDisplayMode: "show_customer",
  productionInternalLabel: null,
  productionVisibleFolderIds: [],
  productionStatusNote: null,
};

export function parseJobProductionSettings(
  job: Record<string, unknown> | null | undefined
): JobProductionSettings {
  if (!job || typeof job !== "object") return { ...DEFAULT_JOB_PRODUCTION_SETTINGS };
  const idsRaw = job.productionAssignedEmployeeIds;
  const ids = Array.isArray(idsRaw)
    ? idsRaw.map((x) => String(x)).filter((s) => s.length > 0)
    : [];
  const modeRaw = job.productionCustomerDisplayMode;
  const mode: ProductionCustomerDisplayMode =
    modeRaw === "internal_only" ? "internal_only" : "show_customer";
  const folderRaw = job.productionVisibleFolderIds;
  const folderIds = Array.isArray(folderRaw)
    ? folderRaw.map((x) => String(x)).filter((s) => s.length > 0)
    : [];
  return {
    productionAssignedEmployeeIds: ids,
    productionCustomerDisplayMode: mode,
    productionInternalLabel:
      typeof job.productionInternalLabel === "string"
        ? job.productionInternalLabel
        : null,
    productionVisibleFolderIds: folderIds,
    productionStatusNote:
      typeof job.productionStatusNote === "string" ? job.productionStatusNote : null,
  };
}

export function employeeAssignedToJobProduction(
  settings: JobProductionSettings,
  employeeDocId: string | null | undefined
): boolean {
  if (!employeeDocId) return false;
  return settings.productionAssignedEmployeeIds.includes(employeeDocId);
}

/** Bezpečný výřez zakázky pro výrobní tým (žádné finance / doklady). */
function serializeFirestoreTime(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString();
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

export function buildProductionSafeJobView(params: {
  jobId: string;
  job: Record<string, unknown>;
  settings: JobProductionSettings;
  customerDisplayName: string;
}): Record<string, unknown> {
  const { jobId, job, settings, customerDisplayName } = params;
  const showCustomer = settings.productionCustomerDisplayMode === "show_customer";
  const internal =
    typeof settings.productionInternalLabel === "string" && settings.productionInternalLabel.trim()
      ? settings.productionInternalLabel.trim()
      : null;
  const name = typeof job.name === "string" ? job.name : "";
  const wf = parseProductionWorkflowStatus(job);
  const productionStatusRaw =
    typeof job.productionStatus === "string" && job.productionStatus.trim()
      ? job.productionStatus.trim()
      : null;
  return {
    jobId,
    name,
    status: typeof job.status === "string" ? job.status : "",
    startDate: typeof job.startDate === "string" ? job.startDate : null,
    endDate: typeof job.endDate === "string" ? job.endDate : null,
    description: typeof job.description === "string" ? job.description : "",
    measuring: typeof job.measuring === "string" ? job.measuring : "",
    measuringDetails: typeof job.measuringDetails === "string" ? job.measuringDetails : "",
    productionTeamNotes:
      typeof job.productionTeamNotes === "string" ? job.productionTeamNotes : "",
    productionStatusNote: settings.productionStatusNote || null,
    /** Stav výroby pro přehledy (např. active po zahájení). */
    productionStatus: productionStatusRaw,
    displayLabel: showCustomer
      ? customerDisplayName || name || jobId
      : internal || name || "Interní zakázka",
    showCustomerName: showCustomer,
    productionWorkflowStatus: wf,
    productionWorkflowStatusLabel: PRODUCTION_WORKFLOW_LABELS[wf],
    productionStartedAt: serializeFirestoreTime(job.productionStartedAt),
    productionStartedBy: typeof job.productionStartedBy === "string" ? job.productionStartedBy : null,
    productionStartedByName:
      typeof job.productionStartedByName === "string" ? job.productionStartedByName : null,
    productionCompletedAt: serializeFirestoreTime(job.productionCompletedAt),
    productionCompletedBy:
      typeof job.productionCompletedBy === "string" ? job.productionCompletedBy : null,
    productionCompletedByName:
      typeof job.productionCompletedByName === "string" ? job.productionCompletedByName : null,
  };
}
