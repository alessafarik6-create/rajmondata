import {
  type CompanyDocumentPaymentRow,
  getDocumentPaymentUrgency,
} from "@/lib/company-document-payment";

/** Stejný typ jako u faktur z job billingu — daňový doklad k hotovostní platbě. */
const TAX_RECEIPT_RECEIVED_PAYMENT_TYPE = "tax_receipt_received_payment";

export type CompanyDocumentPaymentHighlight = "cash" | "paid" | "urgent";

function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function haystack(row: Record<string, unknown>): string {
  const parts = [
    row.note,
    row.poznamka,
    row.description,
    row.internalNote,
    row.paymentNote,
  ]
    .map((x) => String(x ?? ""))
    .join(" ")
    .toLowerCase();
  return parts;
}

/**
 * Detekce „hotově“ — preferujeme explicitní pole z dat, jinak bezpečný textový hint jen u zaplacených dokladů.
 */
export function rowIndicatesCashPayment(row: Record<string, unknown>): boolean {
  if (norm(row.type) === TAX_RECEIPT_RECEIVED_PAYMENT_TYPE) return true;

  const keys = [
    "paymentMethod",
    "paymentType",
    "settlementMethod",
    "paymentKind",
    "typPlatby",
    "typ_platby",
    "payment_mode",
  ] as const;
  for (const k of keys) {
    const v = norm(row[k]);
    if (!v) continue;
    if (v.includes("hotov")) return true;
    if (v.includes("cash")) return true;
    if (v === "c") return true;
  }

  const paid = row.paid === true;
  if (!paid) return false;
  const h = haystack(row);
  return h.includes("hotov") || h.includes("v hotovosti") || h.includes("cash");
}

/**
 * Priorita:
 * 1) hotově → žlutá
 * 2) zaplaceno → zelená
 * 3) po splatnosti / blížící se splatnost / chybí splatnost u dokladu k úhradě → červená
 */
export function classifyCompanyDocumentPaymentHighlight(
  row: CompanyDocumentPaymentRow,
  todayIso: string
): CompanyDocumentPaymentHighlight | null {
  const r = row as CompanyDocumentPaymentRow & Record<string, unknown>;
  if (rowIndicatesCashPayment(r)) return "cash";
  if (row.paid === true) return "paid";

  if (!row.requiresPayment) return null;
  const u = getDocumentPaymentUrgency(row, todayIso);
  if (u === "paid" || u === "not_applicable") return null;
  if (u === "overdue" || u === "due_soon" || u === "incomplete_no_due") return "urgent";
  // `ok` = splatnost ještě daleko — bez červeného zvýraznění
  return null;
}

export function invoiceRecordToPaymentRow(
  inv: Record<string, unknown>
): CompanyDocumentPaymentRow & Record<string, unknown> {
  const status = String(inv.status ?? "");
  const dueRaw = inv.dueDate;
  const due =
    typeof dueRaw === "string" && dueRaw.trim()
      ? dueRaw.trim().slice(0, 10)
      : null;
  const paid = status === "paid";
  const requiresPayment = status !== "draft" && status.length > 0;
  return {
    ...inv,
    requiresPayment,
    dueDate: due,
    paid,
  };
}

export function classifyInvoicePaymentHighlight(
  inv: Record<string, unknown>,
  todayIso: string
): CompanyDocumentPaymentHighlight | null {
  const status = String(inv.status ?? "");
  if (status === "draft") return null;
  const row = invoiceRecordToPaymentRow(inv);
  return classifyCompanyDocumentPaymentHighlight(row, todayIso);
}

/** Tailwind třídy pro celý řádek / kartu dokladu (desktop + mobil). */
export function companyDocumentPaymentHighlightRowClasses(
  h: CompanyDocumentPaymentHighlight | null
): string {
  if (!h) return "";
  if (h === "cash") {
    return "bg-yellow-50 text-gray-900 hover:bg-yellow-100/70 max-lg:border-yellow-200 max-lg:bg-yellow-50";
  }
  if (h === "paid") {
    return "bg-green-50 text-gray-900 hover:bg-green-100/70 max-lg:border-green-200 max-lg:bg-green-50";
  }
  return "bg-red-50 text-gray-900 hover:bg-red-100/70 max-lg:border-red-200 max-lg:bg-red-50";
}
