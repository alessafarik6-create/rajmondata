import type { CompanyDocumentPaymentRow } from "@/lib/company-document-payment";

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
 * 3) nezaplaceno (výchozí) → červená — bez ohledu na splatnost / requiresPayment
 */
export function classifyCompanyDocumentPaymentHighlight(
  row: CompanyDocumentPaymentRow
): CompanyDocumentPaymentHighlight {
  const r = row as CompanyDocumentPaymentRow & Record<string, unknown>;
  if (rowIndicatesCashPayment(r)) return "cash";
  if (row.paid === true) return "paid";
  return "urgent";
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
  inv: Record<string, unknown>
): CompanyDocumentPaymentHighlight {
  const row = invoiceRecordToPaymentRow(inv);
  return classifyCompanyDocumentPaymentHighlight(row);
}

/** Tailwind třídy pro celý řádek / kartu dokladu (desktop + mobil). */
export function companyDocumentPaymentHighlightRowClasses(
  h: CompanyDocumentPaymentHighlight | null
): string {
  if (!h) return "";
  if (h === "cash") {
    return "border-yellow-200 bg-yellow-50 text-gray-900 hover:bg-yellow-100/70 max-lg:border max-lg:border-yellow-200 max-lg:bg-yellow-50";
  }
  if (h === "paid") {
    return "border-green-200 bg-green-50 text-gray-900 hover:bg-green-100/70 max-lg:border max-lg:border-green-200 max-lg:bg-green-50";
  }
  return "border-red-200 bg-red-50 text-gray-900 hover:bg-red-100/70 max-lg:border max-lg:border-red-200 max-lg:bg-red-50";
}

/** Celý řádek dokladu — stejná logika jako `classifyCompanyDocumentPaymentHighlight` + Tailwind. */
export function getDocumentStatusStyle(row: CompanyDocumentPaymentRow): string {
  return companyDocumentPaymentHighlightRowClasses(
    classifyCompanyDocumentPaymentHighlight(row)
  );
}

/** Faktura v seznamu: stejná priorita jako u dokladů (včetně konceptu = nezaplaceno → červená). */
export function getInvoiceDocumentStatusStyle(inv: Record<string, unknown>): string {
  return companyDocumentPaymentHighlightRowClasses(
    classifyInvoicePaymentHighlight(inv)
  );
}
