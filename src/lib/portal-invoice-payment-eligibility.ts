/** Klientsky bezpečná logika pro rychlou úhradu faktury (bez firebase-admin). */

import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import {
  getPortalInvoicePaymentState,
  isPortalInvoiceExcludedFromPaymentSummary,
} from "@/lib/invoice-payment-state";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";

export type InvoicePaymentMethod = "bank" | "cash" | "card" | "other";

export function isIssuedInvoiceEligibleForQuickPay(
  inv: Record<string, unknown>,
  todayIso?: string
): boolean {
  if (!isActiveFirestoreDoc(inv)) return false;
  if (isPortalInvoiceExcludedFromPaymentSummary(inv)) return false;
  const status = String(inv.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "draft") return false;
  const t = String(inv.type ?? "").trim();
  if (t === JOB_INVOICE_TYPES.TAX_RECEIPT) return false;
  const today =
    todayIso ?? new Date().toISOString().split("T")[0] ?? "2099-01-01";
  return getPortalInvoicePaymentState(inv, today).remainingAmount > 0.009;
}

export function invoicePaymentMethodLabel(method: InvoicePaymentMethod): string {
  switch (method) {
    case "bank":
      return "Bankovní převod";
    case "cash":
      return "Hotově";
    case "card":
      return "Kartou";
    default:
      return "Jiný";
  }
}
