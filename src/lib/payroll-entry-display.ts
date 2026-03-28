/**
 * Jednotná logika „schválený / neschválený výdělek“ pro přehled docházky a výplaty dne.
 *
 * Pravidlo: zaplacený den (`paid === true`) se pro účely výdělku bere jako schválený
 * a nikdy nesmí spadat do neschváleného sloupce.
 */

export type PayrollPaidStatus = "paid" | "unpaid" | "none";

export type PayrollSchvalenoStatus = "approved" | "pending" | "none";

function roundMoney2(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export function isEntryPaid(paidStatus: PayrollPaidStatus): boolean {
  return paidStatus === "paid";
}

/** Schválení práce (výkaz / bloky) — bez náhrady přes výplatu dne. */
export function isWorkApprovedForPayroll(params: {
  dayApprovedByDailyReport: boolean;
  schvalenoStatus: PayrollSchvalenoStatus;
}): boolean {
  if (params.dayApprovedByDailyReport) return true;
  return params.schvalenoStatus === "approved";
}

/** Pro zobrazení souhrnů: schváleno pro výplatu = práce schválena nebo den vyplacen. */
export function isEntryApprovedForPayroll(params: {
  workApproved: boolean;
  paidForDay: boolean;
}): boolean {
  return params.workApproved || params.paidForDay === true;
}

/** Neschváleno pro výplatu jen pokud není ani schválená práce ani výplata dne. */
export function isEntryUnapprovedForPayroll(params: {
  workApproved: boolean;
  paidForDay: boolean;
}): boolean {
  return !params.workApproved && params.paidForDay !== true;
}

export type PayrollDisplayMoneyInput = {
  orientacniKc: number;
  /** Částka schválená z výkazu/bloků (před úpravou o výplatu dne). */
  workSchvalenoKc: number;
  workNeschvalenoKc: number;
  dayApprovedByDailyReport: boolean;
  schvalenoStatus: PayrollSchvalenoStatus;
  paidForDay: boolean;
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
  const workApproved = isWorkApprovedForPayroll({
    dayApprovedByDailyReport: p.dayApprovedByDailyReport,
    schvalenoStatus: p.schvalenoStatus,
  });

  if (p.paidForDay) {
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
  dayApprovedByDailyReport: boolean;
  schvalenoStatus: PayrollSchvalenoStatus;
  paidForDay: boolean;
  hasIncompleteAttendance: boolean;
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

  const workApproved = isWorkApprovedForPayroll({
    dayApprovedByDailyReport: p.dayApprovedByDailyReport,
    schvalenoStatus: p.schvalenoStatus,
  });

  if (p.paidForDay) {
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
