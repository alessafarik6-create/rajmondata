/**
 * Evidence výplat za kalendářní měsíc (companies/{companyId}/payroll_period_payments).
 */

export type PayrollPeriodPaymentStatus = "unpaid" | "partial" | "paid";

export type PayrollPeriodPaymentDoc = {
  id: string;
  companyId: string;
  employeeId: string;
  /** např. "2026-04" */
  payrollPeriod: string;
  /** Snímek / orientace při uložení (Kč) */
  calculatedAmount: number;
  /** Skutečně vyplaceno (Kč) */
  paidAmount: number;
  /** Datum výplaty YYYY-MM-DD */
  paymentDate: string;
  paymentStatus: PayrollPeriodPaymentStatus;
  paymentNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
  updatedBy?: string;
};

export function parsePayrollPeriodPayment(
  id: string,
  data: Record<string, unknown> | null | undefined
): PayrollPeriodPaymentDoc | null {
  if (!data || typeof data !== "object") return null;
  const employeeId = String(data.employeeId ?? "").trim();
  const payrollPeriod = String(data.payrollPeriod ?? "").trim();
  if (!employeeId || !/^\d{4}-\d{2}$/.test(payrollPeriod)) return null;
  const st = String(data.paymentStatus ?? "unpaid");
  const status: PayrollPeriodPaymentStatus =
    st === "paid" || st === "partial" || st === "unpaid" ? st : "unpaid";
  const calc = Number(data.calculatedAmount);
  const paid = Number(data.paidAmount);
  return {
    id,
    companyId: String(data.companyId ?? ""),
    employeeId,
    payrollPeriod,
    calculatedAmount: Number.isFinite(calc) ? calc : 0,
    paidAmount: Number.isFinite(paid) ? paid : 0,
    paymentDate: String(data.paymentDate ?? "").slice(0, 10),
    paymentStatus: status,
    paymentNote:
      data.paymentNote != null ? String(data.paymentNote) : undefined,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy:
      data.createdBy != null ? String(data.createdBy) : undefined,
    updatedBy:
      data.updatedBy != null ? String(data.updatedBy) : undefined,
  };
}

export function paymentStatusBadgeClass(
  status: PayrollPeriodPaymentStatus
): string {
  switch (status) {
    case "paid":
      return "bg-emerald-600 text-white hover:bg-emerald-600 border-transparent";
    case "partial":
      return "bg-orange-500 text-white hover:bg-orange-500 border-transparent";
    default:
      return "bg-red-600 text-white hover:bg-red-600 border-transparent";
  }
}

export function paymentStatusLabel(
  status: PayrollPeriodPaymentStatus
): string {
  switch (status) {
    case "paid":
      return "Vyplaceno";
    case "partial":
      return "Částečně vyplaceno";
    default:
      return "Nevyplaceno";
  }
}
