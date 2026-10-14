import type { ProductionTimeEndReason } from "@/lib/production-qr/production-task-types";

/** Stav QR výroby pro přehled „Kdo právě pracuje“ a terminál. */
export type ProductionQrDisplayStatus =
  | "active"
  | "paused_lunch"
  | "paused_travel"
  | "paused_tariff"
  | "ended";

export type ProductionQrSessionDoc = {
  companyId: string;
  employeeId: string;
  jobId: string;
  productionTaskId: string;
  jobName?: string | null;
  taskName?: string | null;
  displayStatus: ProductionQrDisplayStatus;
  /** Běžící interval (null při pozastavení). */
  activeEntryId?: string | null;
  pendingResume: boolean;
  pausedAt?: string | null;
  pauseTariffId?: string | null;
  pauseTariffName?: string | null;
  /** První start QR úkolu v rámci směny (ISO). */
  sessionStartedAt?: string | null;
  shiftDateIso: string;
  updatedAt?: unknown;
};

export type TariffPauseMeta = {
  name?: string | null;
  category?: string | null;
};

export function productionQrDisplayStatusForTariff(
  tariff: TariffPauseMeta
): ProductionQrDisplayStatus {
  const name = String(tariff.name ?? "").toLowerCase();
  const cat = String(tariff.category ?? "").toLowerCase();
  if (
    name.includes("oběd") ||
    name.includes("obed") ||
    name.includes("lunch") ||
    cat.includes("oběd") ||
    cat.includes("obed") ||
    cat === "lunch"
  ) {
    return "paused_lunch";
  }
  if (
    name.includes("cesta") ||
    name.includes("travel") ||
    name.includes("doprava") ||
    cat.includes("cesta") ||
    cat === "travel"
  ) {
    return "paused_travel";
  }
  return "paused_tariff";
}

export function productionEndReasonForTariffPause(
  tariff: TariffPauseMeta
): "attendance_lunch" | "attendance_break" {
  const st = productionQrDisplayStatusForTariff(tariff);
  return st === "paused_lunch" ? "attendance_lunch" : "attendance_break";
}

export function productionQrStatusLabelCs(status: ProductionQrDisplayStatus): string {
  switch (status) {
    case "active":
      return "Aktivní";
    case "paused_lunch":
      return "Pozastaveno – Oběd";
    case "paused_travel":
      return "Pozastaveno – Cesta";
    case "paused_tariff":
      return "Pozastaveno – jiný tarif";
    case "ended":
      return "Ukončeno";
    default:
      return "—";
  }
}

export const PRODUCTION_PAUSE_END_REASONS: ProductionTimeEndReason[] = [
  "attendance_lunch",
  "attendance_break",
];

export function isProductionPauseEndReason(
  reason: ProductionTimeEndReason | null | undefined
): boolean {
  return reason != null && PRODUCTION_PAUSE_END_REASONS.includes(reason);
}
