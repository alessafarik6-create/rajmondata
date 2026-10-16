import type { PreliminaryDealDoc, PreliminaryDealStatus } from "@/lib/leads/preliminary-deal-types";

export type PreliminaryDealsSummary = {
  count: number;
  pipelineValue: number;
  waitingConfirmationValue: number;
  confirmedValue: number;
  convertedValue: number;
};

function dealAmount(d: Pick<PreliminaryDealDoc, "priceAmount" | "status">): number {
  const n = Number(d.priceAmount);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (d.status === "zruseno") return 0;
  return n;
}

/** Souhrn respektuje filtrovaný seznam — převedené se nepočítají do pipeline (bez dvojího započtení). */
export function computePreliminaryDealsSummary(
  deals: Pick<PreliminaryDealDoc, "priceAmount" | "status">[]
): PreliminaryDealsSummary {
  let count = 0;
  let pipelineValue = 0;
  let waitingConfirmationValue = 0;
  let confirmedValue = 0;
  let convertedValue = 0;

  for (const d of deals) {
    if (d.status === "zruseno") continue;
    count += 1;
    const amt = dealAmount(d);
    if (d.status === "prevedeno_do_zakazky") {
      convertedValue += amt;
      continue;
    }
    pipelineValue += amt;
    if (d.status === "ceka_na_potvrzeni") waitingConfirmationValue += amt;
    if (d.status === "potvrzeno") confirmedValue += amt;
  }

  return {
    count,
    pipelineValue,
    waitingConfirmationValue,
    confirmedValue,
    convertedValue,
  };
}

export function preliminaryDealMatchesFilters(
  d: PreliminaryDealDoc & { id?: string },
  filters: {
    q?: string;
    status?: PreliminaryDealStatus | "all";
    responsibleEmployeeId?: string | "all";
    dateFrom?: string;
    dateTo?: string;
  },
  createdAtDate: Date | null
): boolean {
  if (filters.status && filters.status !== "all" && d.status !== filters.status) return false;
  if (
    filters.responsibleEmployeeId &&
    filters.responsibleEmployeeId !== "all" &&
    (d.responsibleEmployeeId ?? "") !== filters.responsibleEmployeeId
  ) {
    return false;
  }
  if (filters.dateFrom && createdAtDate) {
    const from = new Date(`${filters.dateFrom}T00:00:00`);
    if (createdAtDate < from) return false;
  }
  if (filters.dateTo && createdAtDate) {
    const to = new Date(`${filters.dateTo}T23:59:59.999`);
    if (createdAtDate > to) return false;
  }
  const q = (filters.q ?? "").trim().toLowerCase();
  if (!q) return true;
  const blob = [
    d.title,
    d.description,
    d.customerName,
    d.customerPhone,
    d.customerEmail,
    d.note,
    d.responsibleEmployeeName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}
