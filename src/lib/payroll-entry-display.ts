/**
 * Jednotná logika „schválený / neschválený výdělek“ a výplaty dne.
 *
 * Schválený sloupec smí ukazovat částku jen pokud je práce **explicitně** schválená
 * (schválený denní výkaz nebo plně schválené work_time_bloky), nebo je den **zaplacený**.
 * Zaplacený den bere celý orientační výdělek jako schválený pro zobrazení.
 */

import { getLoggedHours, getPayableHours, type WorkTimeBlockMoney } from "@/lib/employee-money";

export type PayrollPaidStatus = "paid" | "unpaid" | "none";

export type PayrollSchvalenoStatus = "approved" | "pending" | "none";

const BLOCK_EPS = 0.02;

function roundMoney2(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export function isEntryPaid(paidStatus: PayrollPaidStatus): boolean {
  return paidStatus === "paid";
}

/** Alias: den vyplacen přes výplatu dne (nebo ekvivalent). */
export function isDayPaid(paidStatus: PayrollPaidStatus): boolean {
  return isEntryPaid(paidStatus);
}

/**
 * Práce u dne je explicitně schválená: schválený denní výkaz, nebo všechny bloky
 * mají reviewStatus approved/adjusted a součet schválených hodin pokrývá odpracované.
 * Bloky bez reviewStatus se nepovažují za schválené (legacy).
 */
export function isExplicitWorkApprovedForDay(params: {
  dayApprovedByDailyReport: boolean;
  dayBlocks: WorkTimeBlockMoney[];
}): boolean {
  if (params.dayApprovedByDailyReport) return true;
  const blocks = params.dayBlocks;
  if (blocks.length === 0) return false;
  let totalLogged = 0;
  let totalPayable = 0;
  for (const b of blocks) {
    const logged = getLoggedHours(b);
    totalLogged += logged;
    const st = String(b.reviewStatus ?? "").trim();
    if (st === "pending" || st === "rejected") return false;
    if (st === "approved" || st === "adjusted") {
      totalPayable += getPayableHours(b);
      continue;
    }
    return false;
  }
  return totalLogged > BLOCK_EPS && totalPayable >= totalLogged - BLOCK_EPS;
}

/** Schválení práce v DB — bez náhrady zaplacením dne. */
export function isWorkApprovedForPayroll(explicitWorkApproved: boolean): boolean {
  return explicitWorkApproved;
}

/** Pro sloupce výdělku: schváleno = explicitně schválená práce nebo zaplacený den. */
export function isDayApprovedForEarningsDisplay(params: {
  explicitWorkApproved: boolean;
  paidForDay: boolean;
}): boolean {
  return params.explicitWorkApproved || params.paidForDay === true;
}

/** Alias: `approved === true || paid === true` pro zobrazení výdělku. */
export function isDayApproved(params: {
  explicitWorkApproved: boolean;
  paidForDay: boolean;
}): boolean {
  return isDayApprovedForEarningsDisplay(params);
}

/** @deprecated použijte isDayApprovedForEarningsDisplay */
export function isEntryApprovedForPayroll(params: {
  workApproved: boolean;
  paidForDay: boolean;
}): boolean {
  return isDayApprovedForEarningsDisplay({
    explicitWorkApproved: params.workApproved,
    paidForDay: params.paidForDay,
  });
}

export function isEntryUnapprovedForPayroll(params: {
  workApproved: boolean;
  paidForDay: boolean;
}): boolean {
  return !params.workApproved && params.paidForDay !== true;
}

export type PayrollDisplayMoneyInput = {
  orientacniKc: number;
  /** Poměrná část z bloků (interně); do UI schváleného sloupce jde jen při explicitWorkApproved nebo paid. */
  workSchvalenoKc: number;
  workNeschvalenoKc: number;
  explicitWorkApproved: boolean;
  paidForDay: boolean;
  /** Schválení dne adminem (employee_day_payouts.approved) — celý orientační výdělek do schváleného sloupce. */
  adminDayApproved?: boolean;
};

/**
 * Částky pro sloupce „Schválený výdělek“ / „Neschválený výdělek“ v UI.
 */
/** Alias: schválený výdělek pro zobrazení (včetně vlivu výplaty dne). */
export function getPayrollApprovedDisplayKc(p: PayrollDisplayMoneyInput): number {
  return computePayrollDisplayEarningsKc(p).payrollApprovedKc;
}

/** Alias: neschválený výdělek pro zobrazení. */
export function getPayrollUnapprovedDisplayKc(p: PayrollDisplayMoneyInput): number {
  return computePayrollDisplayEarningsKc(p).payrollUnapprovedKc;
}

export function computePayrollDisplayEarningsKc(
  p: PayrollDisplayMoneyInput
): { payrollApprovedKc: number; payrollUnapprovedKc: number } {
  const o = roundMoney2(p.orientacniKc);
  const workApproved = isWorkApprovedForPayroll(p.explicitWorkApproved);

  if (p.paidForDay || p.adminDayApproved === true) {
    return { payrollApprovedKc: o, payrollUnapprovedKc: 0 };
  }
  if (!workApproved) {
    return { payrollApprovedKc: 0, payrollUnapprovedKc: o };
  }
  return {
    payrollApprovedKc: roundMoney2(p.workSchvalenoKc),
    payrollUnapprovedKc: roundMoney2(p.workNeschvalenoKc),
  };
}

export type PayrollDisplayHourlyInput = {
  hourlyHoursForPay: number;
  orientacniKc: number;
  workSchvalenoKc: number;
  workNeschvalenoKc: number;
  explicitWorkApproved: boolean;
  paidForDay: boolean;
  hasIncompleteAttendance: boolean;
  adminDayApproved?: boolean;
};

const H_EPS = 1e-6;

/**
 * Rozdělení hodinové práce (mimo tarif/zakázku) pro souhrny schválené / neschválené hodiny.
 */
export function computePayrollDisplayHourlyHours(
  p: PayrollDisplayHourlyInput
): { approvedH: number; pendingH: number } {
  if (p.hasIncompleteAttendance) return { approvedH: 0, pendingH: 0 };
  const oh = Number(p.hourlyHoursForPay);
  if (!Number.isFinite(oh) || oh <= H_EPS) return { approvedH: 0, pendingH: 0 };

  const workApproved = isWorkApprovedForPayroll(p.explicitWorkApproved);

  if (p.paidForDay || p.adminDayApproved === true) {
    return { approvedH: Math.round(oh * 100) / 100, pendingH: 0 };
  }
  if (!workApproved) {
    return { approvedH: 0, pendingH: Math.round(oh * 100) / 100 };
  }

  const o = roundMoney2(p.orientacniKc);
  if (o > 0.001) {
    const ratioOk = Math.min(1, Math.max(0, p.workSchvalenoKc / o));
    const approvedH = Math.round(oh * ratioOk * 100) / 100;
    const pendingH = Math.round((oh - approvedH) * 100) / 100;
    return { approvedH, pendingH };
  }
  return { approvedH: Math.round(oh * 100) / 100, pendingH: 0 };
}

/** Stav řádku pro badge „schváleno“ v kartě dne (zaplaceno ⇒ ber jako schváleno pro výplatu). */
export function effectiveSchvalenoStatusForDisplay(
  schvalenoStatus: PayrollSchvalenoStatus,
  paidStatus: PayrollPaidStatus
): PayrollSchvalenoStatus {
  if (paidStatus === "paid") return "approved";
  return schvalenoStatus;
}

/** Text badge podle výplaty dne (žádná platba = Bez platby). */
export function getPaymentBadgeLabel(paidStatus: PayrollPaidStatus): "Zaplaceno" | "Nezaplaceno" | "Bez platby" {
  if (paidStatus === "paid") return "Zaplaceno";
  if (paidStatus === "unpaid") return "Nezaplaceno";
  return "Bez platby";
}

/** Schválená částka pro kartu dne (stejná logika jako souhrny). */
export function getApprovedEarningsKc(p: PayrollDisplayMoneyInput): number {
  return getPayrollApprovedDisplayKc(p);
}

/** Neschválená částka pro kartu dne. */
export function getUnapprovedEarningsKc(p: PayrollDisplayMoneyInput): number {
  return getPayrollUnapprovedDisplayKc(p);
}
