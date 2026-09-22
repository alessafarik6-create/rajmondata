/**
 * Jediný zdroj pravdy pro zbývající částku, stav úhrady a splatnost dokladů / faktur.
 */

import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { roundMoney2 } from "@/lib/vat-calculations";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";

export type InvoicePaymentState = {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  isPaid: boolean;
  isPartiallyPaid: boolean;
  isUnpaid: boolean;
  isOverdue: boolean;
  dueDate: string | null;
};

export type PaymentStateRow = Record<string, unknown> & {
  id?: string;
  dueDate?: string | null;
  paid?: boolean;
  paidAt?: unknown;
  paymentStatus?: string | null;
  paidAmount?: number | null;
  paidGrossReceived?: number | null;
  status?: string | null;
  castkaCZK?: number;
  amountGrossCZK?: number;
  castka?: number;
  amountGross?: number;
  amount?: number;
  amountNet?: number;
  totalAmount?: number;
  totalAmountCZK?: number;
  amountDue?: number;
  requiresPayment?: boolean;
  isDeleted?: boolean;
  deletedAt?: unknown;
  storno?: boolean;
  cancelled?: boolean;
  type?: string;
};

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

export function documentTotalAmountGross(row: PaymentStateRow): number {
  const czkG = Number(row.castkaCZK ?? row.amountGrossCZK ?? row.totalAmountCZK ?? 0);
  if (Number.isFinite(czkG) && czkG > 0) return roundMoney2(czkG);
  const c = Number(row.castka ?? 0);
  const g = Number(row.amountGross ?? row.totalAmount ?? 0);
  const n = Number(row.amountNet ?? row.amount ?? 0);
  if (Number.isFinite(c) && c > 0) return roundMoney2(c);
  if (Number.isFinite(g) && g > 0) return roundMoney2(g);
  if (Number.isFinite(n) && n > 0) return roundMoney2(n);
  return 0;
}

export function portalInvoiceTotalAmountGross(inv: PaymentStateRow): number {
  const czkG = Number(
    inv.amountGrossCZK ?? inv.castkaCZK ?? inv.totalAmountCZK ?? 0
  );
  if (Number.isFinite(czkG) && czkG > 0) return roundMoney2(czkG);
  const g = Number(inv.amountGross ?? inv.totalAmount ?? 0);
  if (Number.isFinite(g) && g > 0) return roundMoney2(g);
  return 0;
}

function normalizeDocumentPaymentStatus(row: PaymentStateRow): "unpaid" | "partial" | "paid" {
  const st = String(row.paymentStatus ?? "")
    .trim()
    .toLowerCase();
  if (st === "paid" || row.paid === true) return "paid";
  if (st === "partial") return "partial";
  return "unpaid";
}

function normalizeInvoicePaymentStatus(inv: PaymentStateRow): "unpaid" | "partial" | "paid" {
  const status = String(inv.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "paid") return "paid";
  if (status === "partially_paid" || status === "partial") return "partial";
  const ps = String(inv.paymentStatus ?? "")
    .trim()
    .toLowerCase();
  if (ps === "paid") return "paid";
  if (ps === "partial") return "partial";
  return "unpaid";
}

function rawPaidAmount(row: PaymentStateRow): number {
  const a = Number(row.paidAmount ?? 0);
  const b = Number(row.paidGrossReceived ?? 0);
  let paid = 0;
  if (Number.isFinite(a) && a > 0) paid = Math.max(paid, a);
  if (Number.isFinite(b) && b > 0) paid = Math.max(paid, b);
  return roundMoney2(paid);
}

function buildPaymentState(
  totalAmount: number,
  paidAmountRaw: number,
  statusNorm: "unpaid" | "partial" | "paid",
  dueDate: string | null,
  todayIso: string
): InvoicePaymentState {
  const total = roundMoney2(Math.max(0, totalAmount));
  let paid = roundMoney2(Math.max(0, paidAmountRaw));
  if (total > 0 && paid > total) paid = total;

  if (statusNorm === "paid" && total > 0 && paid < total - 0.009) {
    paid = total;
  }
  if (statusNorm === "paid" && total <= 0) {
    paid = 0;
  }

  let remaining = total > 0 ? Math.max(0, roundMoney2(total - paid)) : 0;
  if (paid >= total - 0.009 && total > 0) {
    remaining = 0;
    paid = total;
  }

  const isPaid = remaining <= 0 && (total > 0 || statusNorm === "paid");
  const isPartiallyPaid = !isPaid && paid > 0 && total > 0;
  const isUnpaid = !isPaid && !isPartiallyPaid;

  const due = String(dueDate ?? "").trim() || null;
  const isOverdue =
    remaining > 0 &&
    Boolean(due) &&
    compareIsoDate(due!, todayIso) < 0;

  return {
    totalAmount: total,
    paidAmount: paid,
    remainingAmount: remaining,
    isPaid,
    isPartiallyPaid,
    isUnpaid,
    isOverdue,
    dueDate: due,
  };
}

/** @alias getDocumentPaymentState — jednotné API pro doklady i faktury v UI. */
export function getInvoicePaymentState(
  row: PaymentStateRow,
  todayIso: string
): InvoicePaymentState {
  return getDocumentPaymentState(row, todayIso);
}

export function getDocumentPaymentState(
  row: PaymentStateRow,
  todayIso: string
): InvoicePaymentState {
  const total = documentTotalAmountGross(row);
  const statusNorm = normalizeDocumentPaymentStatus(row);
  const paid = rawPaidAmount(row);
  return buildPaymentState(
    total,
    paid,
    statusNorm,
    String(row.dueDate ?? "").trim() || null,
    todayIso
  );
}

export function getPortalInvoicePaymentState(
  inv: PaymentStateRow,
  todayIso: string,
  linkedDocument?: PaymentStateRow | null
): InvoicePaymentState {
  const invTotal = portalInvoiceTotalAmountGross(inv);
  const invPaid = rawPaidAmount(inv);
  const invStatus = normalizeInvoicePaymentStatus(inv);
  const invState = buildPaymentState(
    invTotal,
    invPaid,
    invStatus,
    String(inv.dueDate ?? "").trim() || null,
    todayIso
  );

  if (!linkedDocument) return invState;

  const docState = getDocumentPaymentState(linkedDocument, todayIso);
  const total =
    invState.totalAmount > 0 ? invState.totalAmount : docState.totalAmount;
  const paidAmount = roundMoney2(
    Math.max(invState.paidAmount, docState.paidAmount)
  );
  const statusNorm: "unpaid" | "partial" | "paid" =
    invState.isPaid || docState.isPaid
      ? "paid"
      : invState.isPartiallyPaid || docState.isPartiallyPaid
        ? "partial"
        : "unpaid";

  return buildPaymentState(
    total,
    paidAmount,
    statusNorm,
    String(inv.dueDate ?? linkedDocument.dueDate ?? "").trim() || null,
    todayIso
  );
}

/** Daňový doklad k přijaté platbě není pohledávka k inkasu. */
export function isPortalInvoiceExcludedFromPaymentSummary(
  inv: PaymentStateRow
): boolean {
  const t = String(inv.type ?? "").trim().toLowerCase();
  if (t === JOB_INVOICE_TYPES.TAX_RECEIPT) return true;
  if (t === "tax_receipt_received_payment") return true;
  const status = String(inv.status ?? "")
    .trim()
    .toLowerCase();
  if (
    status === "draft" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "storno"
  ) {
    return true;
  }
  if (inv.storno === true || inv.cancelled === true) return true;
  return false;
}

export function isDocumentExcludedFromPaymentSummary(row: PaymentStateRow): boolean {
  if (!isActiveFirestoreDoc(row)) return true;
  if (row.requiresPayment !== true) return true;
  return false;
}

export type PaymentSummarySide = {
  openCount: number;
  openAmount: number;
  overdueCount: number;
  overdueAmount: number;
};

export type PaymentSummaryResult = {
  received: PaymentSummarySide;
  issued: PaymentSummarySide;
};

export function calculatePaymentSummary(params: {
  documents: PaymentStateRow[];
  invoices: PaymentStateRow[];
  todayIso: string;
  /** Zrcadla v documents podle sourceInvoiceId. */
  invoiceMirrorBySourceId?: Map<string, PaymentStateRow>;
  /** Přeskočit mirror doklady (počítají se přes invoices). */
  skipPortalInvoiceMirror?: (row: PaymentStateRow) => boolean;
}): PaymentSummaryResult {
  const received: PaymentSummarySide = {
    openCount: 0,
    openAmount: 0,
    overdueCount: 0,
    overdueAmount: 0,
  };
  const issued: PaymentSummarySide = {
    openCount: 0,
    openAmount: 0,
    overdueCount: 0,
    overdueAmount: 0,
  };

  const add = (side: PaymentSummarySide, state: InvoicePaymentState) => {
    if (state.remainingAmount <= 0) return;
    side.openCount += 1;
    side.openAmount = roundMoney2(side.openAmount + state.remainingAmount);
    if (state.isOverdue) {
      side.overdueCount += 1;
      side.overdueAmount = roundMoney2(side.overdueAmount + state.remainingAmount);
    }
  };

  const skipMirror = params.skipPortalInvoiceMirror ?? (() => false);

  for (const d of params.documents) {
    if (isDocumentExcludedFromPaymentSummary(d)) continue;
    if (skipMirror(d)) continue;
    const type = String(d.type ?? d.documentKind ?? "")
      .trim()
      .toLowerCase();
    const section =
      type === "received" || type === "prijate"
        ? "received"
        : type === "issued" || type === "vydane"
          ? "issued"
          : null;
    if (!section) continue;
    const state = getDocumentPaymentState(d, params.todayIso);
    add(section === "received" ? received : issued, state);
  }

  const mirrors = params.invoiceMirrorBySourceId ?? new Map();

  for (const inv of params.invoices) {
    if (!isActiveFirestoreDoc(inv)) continue;
    if (isPortalInvoiceExcludedFromPaymentSummary(inv)) continue;
    const invId = String(inv.id ?? "").trim();
    const mirror = invId ? mirrors.get(invId) : undefined;
    const state = getPortalInvoicePaymentState(inv, params.todayIso, mirror);
    if (state.remainingAmount <= 0) continue;
    add(issued, state);
  }

  return { received, issued };
}
