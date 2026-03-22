/**
 * Zaměření (předstupeň zakázky) — companies/{companyId}/measurements/{id}
 */

export type MeasurementStatus =
  | "planned"
  | "completed"
  | "converted"
  | "cancelled";

export type MeasurementDoc = {
  id: string;
  companyId: string;
  customerName: string;
  phone: string;
  address: string;
  /** ISO 8601 (UTC nebo lokální uložený jako ISO) */
  scheduledAt: string;
  note: string;
  /** Interní poznámka (nepovinná), není určena pro zákazníka */
  internalNote?: string;
  estimatedPrice: number;
  status: MeasurementStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  convertedJobId?: string | null;
  convertedAt?: unknown;
  /** Kdo provedl převod do zakázky */
  convertedByUid?: string | null;
  /** Šablona použitá při posledním převodu */
  selectedTemplateId?: string | null;
  selectedTemplateName?: string | null;
  /** Předchozí ID zakázek při opakovaném převodu ze stejného zaměření */
  previousConvertedJobIds?: string[];
  /** Soft delete — pokud je nastaveno, záznam se v přehledu nezobrazuje */
  deletedAt?: unknown;
};

export const MEASUREMENT_STATUS_LABELS: Record<MeasurementStatus, string> = {
  planned: "Naplánováno",
  completed: "Dokončeno",
  converted: "Převedeno na zakázku",
  cancelled: "Zrušeno",
};

/** Jednoduchá kontrola telefonu (číslice, mezery, +, pomlčky, závorky). */
export function isValidMeasurementPhone(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 9) return false;
  return /^[\d\s+().\-/]{9,}$/.test(t);
}

export function parseEstimatedPrice(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function canConvertMeasurement(m: {
  status?: MeasurementStatus;
}): boolean {
  return m.status === "planned" || m.status === "completed";
}

/** Druhá zakázka ze stejného zaměření — pouze po potvrzení v UI. */
export function canCreateAnotherJobFromMeasurement(m: {
  status?: MeasurementStatus;
}): boolean {
  return m.status === "converted";
}

/** Stejná logika jako oprávnění k zápisu zakázek (privilegované role). */
export function userCanManageMeasurements(profile: {
  role?: string;
  globalRoles?: unknown;
} | null): boolean {
  if (!profile) return false;
  const r = profile.role;
  if (["owner", "admin", "manager", "accountant"].includes(String(r)))
    return true;
  return (
    Array.isArray(profile.globalRoles) &&
    profile.globalRoles.includes("super_admin")
  );
}
