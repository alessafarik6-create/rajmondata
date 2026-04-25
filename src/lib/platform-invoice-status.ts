/** Čistá logika stavu faktury (bez firebase-admin) — použitelné na klientovi i serveru. */

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Efektivní stav pro UI a upozornění (po splatnosti se dopočítá z dueDate). */
export function computeEffectivePlatformInvoiceStatus(
  status: string,
  dueDate: string | null | undefined
): "paid" | "cancelled" | "overdue" | "unpaid" {
  if (status === "paid" || status === "cancelled") return status;
  const d = String(dueDate || "").slice(0, 10);
  const today = todayIsoDate();
  if (d && d < today) return "overdue";
  return "unpaid";
}
