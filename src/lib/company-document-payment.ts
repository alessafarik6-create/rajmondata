/**
 * Splatnost a stav úhrady u firemních dokladů (companies/.../documents).
 */

import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import type { CompanyDocumentLike } from "@/lib/company-documents-financial";
import { roundMoney2 } from "@/lib/vat-calculations";

/** Počet dnů dopředu pro stav „blíží se splatnost“ (včetně dneška). */
export const PAYMENT_DUE_SOON_DAYS = 5;

export type PaymentUrgency =
  | "paid"
  | "not_applicable"
  | "incomplete_no_due"
  | "overdue"
  | "due_soon"
  | "ok";

/** Typ dokladu ve Firestore (`companies/.../documents`). */
export type CompanyDocumentFirestoreType =
  | "invoice"
  | "document"
  | "delivery_note";

export type CompanyDocumentPaymentRow = CompanyDocumentLike & {
  castkaCZK?: number;
  amountGrossCZK?: number;
  id?: string;
  /** received | issued | prijate | vydane | delivery_note … */
  type?: string;
  documentKind?: string;
  documentType?: CompanyDocumentFirestoreType | string;
  sourceInvoiceId?: string | null;
  invoiceId?: string | null;
  nazev?: string;
  entityName?: string;
  number?: string;
  fileName?: string;
  note?: string | null;
  poznamka?: string | null;
  description?: string | null;
  requiresPayment?: boolean;
  dueDate?: string | null;
  paid?: boolean;
  paidAt?: unknown;
  paidBy?: string | null;
  paymentStatus?: "unpaid" | "partial" | "paid" | null;
  paidAmount?: number | null;
  paymentMethod?: string | null;
  paymentNote?: string | null;
  castka?: number;
  amountNet?: number;
  amountGross?: number;
  amount?: number;
};

/** Sjednocené čtení typu/kind dokladu (stejná logika jako v UI Doklady). */
export function documentClassificationValues(
  row: CompanyDocumentPaymentRow
): { type: string; documentKind: string; documentType: string } {
  return {
    type: String(row.type ?? "").trim().toLowerCase(),
    documentKind: String(row.documentKind ?? "").trim().toLowerCase(),
    documentType: String(row.documentType ?? "").trim().toLowerCase(),
  };
}

export function isCompanyDocumentDeliveryNote(
  row: CompanyDocumentPaymentRow
): boolean {
  const { type, documentKind, documentType } = documentClassificationValues(row);
  return (
    documentType === "delivery_note" ||
    type === "delivery_note" ||
    documentKind === "delivery_note"
  );
}

export type CompanyDocumentPaymentStatus = "unpaid" | "partial" | "paid";

export function resolveCompanyDocumentPaymentStatus(
  row: CompanyDocumentPaymentRow
): CompanyDocumentPaymentStatus {
  const st = String(row.paymentStatus ?? "").trim();
  if (st === "paid" || row.paid === true) return "paid";
  if (st === "partial") return "partial";
  return "unpaid";
}

function todayParts(todayIso: string): { y: number; m: number; d: number } {
  const [y, m, d] = todayIso.split("-").map(Number);
  return { y, m, d };
}

function addDaysIso(iso: string, days: number): string {
  const { y, m, d } = todayParts(iso);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Částka s DPH pro přehled k úhradě (shodně s docDisplayAmounts — hrubá). */
export function documentDisplayTitleForPayment(
  row: CompanyDocumentPaymentRow
): string {
  const n =
    row.nazev?.trim() ||
    row.entityName?.trim() ||
    row.number?.trim() ||
    row.fileName?.trim() ||
    "";
  return n || row.id || "";
}

export function documentGrossForPayment(row: CompanyDocumentPaymentRow): number {
  const czkG = Number(row.castkaCZK ?? row.amountGrossCZK ?? 0);
  if (czkG > 0) return roundMoney2(czkG);
  const c = Number(row.castka ?? 0);
  const g = Number(row.amountGross ?? 0);
  const n = Number(row.amountNet ?? row.amount ?? 0);
  if (c > 0) return roundMoney2(c);
  if (g > 0) return roundMoney2(g);
  return roundMoney2(n);
}

/** Zbývající částka s DPH k úhradě (po částečné platbě). */
export function documentRemainingForPayment(row: CompanyDocumentPaymentRow): number {
  if (resolveCompanyDocumentPaymentStatus(row) === "paid") return 0;
  const gross = documentGrossForPayment(row);
  if (gross <= 0) return 0;
  const paid = Number(row.paidAmount ?? 0);
  if (Number.isFinite(paid) && paid > 0) {
    return Math.max(0, roundMoney2(gross - paid));
  }
  return gross;
}

export function portalInvoiceGross(inv: PortalInvoiceRow): number {
  const gross = Number(inv.amountGross ?? inv.totalAmount ?? 0);
  return Number.isFinite(gross) && gross > 0 ? roundMoney2(gross) : 0;
}

/** Zbývající částka k inkasu u vydané faktury (portal invoices). */
export function portalInvoiceRemaining(inv: PortalInvoiceRow): number {
  const status = String(inv.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "paid") return 0;
  const paymentStatus = String(inv.paymentStatus ?? "")
    .trim()
    .toLowerCase();
  if (paymentStatus === "paid") return 0;
  const gross = portalInvoiceGross(inv);
  if (gross <= 0) return 0;
  const paid = Number(inv.paidAmount ?? inv.paidGrossReceived ?? 0);
  if (Number.isFinite(paid) && paid > 0) {
    return Math.max(0, roundMoney2(gross - paid));
  }
  return gross;
}

export function isPortalInvoiceOpenForCollection(inv: PortalInvoiceRow): boolean {
  if (!isActiveFirestoreDoc(inv)) return false;
  const status = String(inv.status ?? "")
    .trim()
    .toLowerCase();
  if (
    status === "paid" ||
    status === "draft" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "storno"
  ) {
    return false;
  }
  return portalInvoiceRemaining(inv) > 0;
}

export function isDocumentEligibleForPaymentBox(
  row: CompanyDocumentPaymentRow
): boolean {
  if (!isActiveFirestoreDoc(row)) return false;
  if (!row.requiresPayment) return false;
  if (!isFinancialCompanyDocument(row)) return false;
  return documentRemainingForPayment(row) > 0;
}

/**
 * Stav úhrady / splatnosti pro zobrazení (badge).
 * Zaplacené doklady: paid.
 * Bez požadavku na úhradu: not_applicable.
 */
export function getDocumentPaymentUrgency(
  row: CompanyDocumentPaymentRow,
  todayIso: string
): PaymentUrgency {
  if (resolveCompanyDocumentPaymentStatus(row) === "paid") return "paid";
  if (!row.requiresPayment) return "not_applicable";
  if (documentRemainingForPayment(row) <= 0) return "paid";
  const due = String(row.dueDate ?? "").trim();
  if (!due) return "incomplete_no_due";
  if (compareIsoDate(due, todayIso) < 0) return "overdue";
  const limitSoon = addDaysIso(todayIso, PAYMENT_DUE_SOON_DAYS);
  if (compareIsoDate(due, limitSoon) <= 0) return "due_soon";
  return "ok";
}

/** Faktury ve výpisu Doklady (portal) — stejná časová logika splatnosti jako u firemních dokladů. */
export type PortalInvoiceRow = Record<string, unknown>;

export function getPortalInvoicePaymentUrgency(
  inv: PortalInvoiceRow,
  todayIso: string
): PaymentUrgency {
  const status = String(inv.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "paid") return "paid";
  if (
    status === "draft" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "storno"
  ) {
    return "not_applicable";
  }
  if (portalInvoiceRemaining(inv) <= 0) return "paid";
  const due = String(inv.dueDate ?? "").trim();
  if (!due) return "incomplete_no_due";
  if (compareIsoDate(due, todayIso) < 0) return "overdue";
  const limitSoon = addDaysIso(todayIso, PAYMENT_DUE_SOON_DAYS);
  if (compareIsoDate(due, limitSoon) <= 0) return "due_soon";
  return "ok";
}

export function paymentStatusLabel(st: CompanyDocumentPaymentStatus): string {
  if (st === "paid") return "Uhrazeno";
  if (st === "partial") return "Částečně uhrazeno";
  return "Neuhrazeno";
}

export function paymentStatusBadgeClass(st: CompanyDocumentPaymentStatus): string {
  if (st === "paid") return "bg-emerald-700 text-white hover:bg-emerald-700";
  if (st === "partial") {
    return "border border-amber-600 bg-amber-100 text-amber-950";
  }
  return "border border-gray-400 bg-gray-100 text-gray-900";
}

export function urgencyLabel(cs: PaymentUrgency): string {
  switch (cs) {
    case "paid":
      return "Zaplaceno";
    case "not_applicable":
      return "—";
    case "incomplete_no_due":
      return "Neúplné (chybí splatnost)";
    case "overdue":
      return "Po splatnosti";
    case "due_soon":
      return "Blíží se splatnost";
    case "ok":
      return "K úhradě";
    default:
      return "—";
  }
}

/** Řazení fronty úhrad: po splatnosti → brzká splatnost → v pořádku → bez data (nakonec). */
export function compareDocumentsForPaymentQueue(
  a: CompanyDocumentPaymentRow,
  b: CompanyDocumentPaymentRow,
  todayIso: string
): number {
  const ua = getDocumentPaymentUrgency(a, todayIso);
  const ub = getDocumentPaymentUrgency(b, todayIso);
  const rank = (u: PaymentUrgency): number => {
    if (u === "overdue") return 0;
    if (u === "due_soon") return 1;
    if (u === "ok") return 2;
    if (u === "incomplete_no_due") return 3;
    return 4;
  };
  const ra = rank(ua);
  const rb = rank(ub);
  if (ra !== rb) return ra - rb;
  const da = String(a.dueDate ?? "").trim();
  const db = String(b.dueDate ?? "").trim();
  if (da && db) return compareIsoDate(da, db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return 0;
}

export function sortDocumentsByDueDateAsc(
  list: CompanyDocumentPaymentRow[],
  todayIso: string
): CompanyDocumentPaymentRow[] {
  return [...list].sort((a, b) =>
    compareDocumentsForPaymentQueue(a, b, todayIso)
  );
}
