/**
 * Souhrn plateb — přijaté (k úhradě) a vydané (k inkasu) odděleně, zbývající částky s DPH.
 */

import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  documentClassificationValues,
  getDocumentPaymentUrgency,
  getPortalInvoicePaymentUrgency,
  isCompanyDocumentDeliveryNote,
  isDocumentEligibleForPaymentBox,
  isPortalInvoiceOpenForCollection,
  type CompanyDocumentPaymentRow,
} from "@/lib/company-document-payment";
import {
  calculatePaymentSummary,
  getDocumentPaymentState,
  getPortalInvoicePaymentState,
  isPortalInvoiceExcludedFromPaymentSummary,
} from "@/lib/invoice-payment-state";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { roundMoney2 } from "@/lib/vat-calculations";

export type PortalPaymentOverdueTarget = {
  flashRowKey: string;
  due: string;
  section: "received" | "issued";
};

export type PortalPaymentSideStats = {
  openCount: number;
  openAmountKc: number;
  overdueCount: number;
  overdueAmountKc: number;
};

export type PortalPaymentOverviewStats = {
  received: PortalPaymentSideStats;
  issued: PortalPaymentSideStats;
  /** Celkový počet otevřených položek (přijaté + vydané) — dashboard / legacy. */
  toPay: number;
  overdueDocuments: number;
  overdueInvoices: number;
  overdueTotal: number;
  /** @deprecated Nepoužívat pro UI — sčítá oba směry. Použijte received/issued. */
  totalKc: number;
  overdueTargets: PortalPaymentOverdueTarget[];
};

const EMPTY_SIDE: PortalPaymentSideStats = {
  openCount: 0,
  openAmountKc: 0,
  overdueCount: 0,
  overdueAmountKc: 0,
};

function isFinancialOrDeliveryDoc(row: CompanyDocumentPaymentRow): boolean {
  return isFinancialCompanyDocument(row) || isCompanyDocumentDeliveryNote(row);
}

/** Zrcadlo vystavené faktury v documents — počítá se jen v kolekci invoices. */
export function isPortalInvoiceMirrorDocument(row: CompanyDocumentPaymentRow): boolean {
  const src = String(row.sourceInvoiceId ?? row.invoiceId ?? "").trim();
  if (src) return true;
  return String(row.source ?? "").trim() === "portalInvoice";
}

export function buildPortalInvoiceMirrorMap(
  documents: CompanyDocumentPaymentRow[]
): Map<string, CompanyDocumentPaymentRow> {
  const map = new Map<string, CompanyDocumentPaymentRow>();
  for (const d of documents) {
    if (!isActiveFirestoreDoc(d)) continue;
    const invId = String(d.sourceInvoiceId ?? d.invoiceId ?? "").trim();
    if (!invId) continue;
    map.set(invId, d);
  }
  return map;
}

export function filterActiveFinancialDocuments<T extends CompanyDocumentPaymentRow>(
  documents: T[] | null | undefined
): T[] {
  return (Array.isArray(documents) ? documents : []).filter(
    (d) => isActiveFirestoreDoc(d) && isFinancialOrDeliveryDoc(d)
  );
}

export function filterActivePortalInvoices(
  invoices: Array<Record<string, unknown> & { id: string }> | null | undefined
): Array<Record<string, unknown> & { id: string }> {
  return (Array.isArray(invoices) ? invoices : []).filter((inv) =>
    isActiveFirestoreDoc(inv)
  );
}

function paymentSectionForDoc(
  d: CompanyDocumentPaymentRow
): "received" | "issued" | null {
  const { type, documentKind } = documentClassificationValues(d);
  if (type === "received" || type === "prijate" || documentKind === "prijate") {
    return "received";
  }
  if (type === "issued" || type === "vydane" || documentKind === "vydane") {
    return "issued";
  }
  return null;
}

export function collectOverduePaymentFlashTargets(
  financialActive: CompanyDocumentPaymentRow[],
  invoices: Array<Record<string, unknown> & { id: string }>,
  todayIso: string
): PortalPaymentOverdueTarget[] {
  const mirrors = buildPortalInvoiceMirrorMap(financialActive);
  const out: PortalPaymentOverdueTarget[] = [];
  for (const d of financialActive) {
    if (isPortalInvoiceMirrorDocument(d)) continue;
    if (!isDocumentEligibleForPaymentBox(d)) continue;
    const state = getDocumentPaymentState(d, todayIso);
    if (state.remainingAmount <= 0 || !state.isOverdue) continue;
    const sec = paymentSectionForDoc(d);
    if (!sec) continue;
    out.push({
      flashRowKey: `doc:${String(d.id ?? "")}`,
      due: state.dueDate ?? "9999-12-31",
      section: sec,
    });
  }
  for (const inv of invoices) {
    if (!isActiveFirestoreDoc(inv)) continue;
    if (isPortalInvoiceExcludedFromPaymentSummary(inv)) continue;
    const invId = String(inv.id ?? "").trim();
    const mirror = invId ? mirrors.get(invId) : undefined;
    const state = getPortalInvoicePaymentState(inv, todayIso, mirror);
    if (state.remainingAmount <= 0 || !state.isOverdue) continue;
    out.push({
      flashRowKey: `inv:${inv.id}`,
      due: state.dueDate ?? "9999-12-31",
      section: "issued",
    });
  }
  out.sort(
    (a, b) =>
      a.due.localeCompare(b.due) || a.flashRowKey.localeCompare(b.flashRowKey)
  );
  return out;
}

export function computePortalPaymentOverviewStats(
  documents: CompanyDocumentPaymentRow[] | null | undefined,
  invoices: Array<Record<string, unknown> & { id: string }> | null | undefined,
  todayIso: string
): PortalPaymentOverviewStats {
  const financialActive = filterActiveFinancialDocuments(documents);
  const invList = filterActivePortalInvoices(invoices);
  const mirrors = buildPortalInvoiceMirrorMap(financialActive);

  const summary = calculatePaymentSummary({
    documents: financialActive,
    invoices: invList,
    todayIso,
    invoiceMirrorBySourceId: mirrors,
    skipPortalInvoiceMirror: (row) =>
      isPortalInvoiceMirrorDocument(row as CompanyDocumentPaymentRow),
  });

  const received: PortalPaymentSideStats = {
    openCount: summary.received.openCount,
    openAmountKc: summary.received.openAmount,
    overdueCount: summary.received.overdueCount,
    overdueAmountKc: summary.received.overdueAmount,
  };
  const issued: PortalPaymentSideStats = {
    openCount: summary.issued.openCount,
    openAmountKc: summary.issued.openAmount,
    overdueCount: summary.issued.overdueCount,
    overdueAmountKc: summary.issued.overdueAmount,
  };

  const overdueTargets = collectOverduePaymentFlashTargets(
    financialActive,
    invList,
    todayIso
  );
  const overdueDocuments = overdueTargets.filter((t) =>
    t.flashRowKey.startsWith("doc:")
  ).length;
  const overdueInvoices = overdueTargets.filter((t) =>
    t.flashRowKey.startsWith("inv:")
  ).length;

  return {
    received,
    issued,
    toPay: received.openCount + issued.openCount,
    totalKc: roundMoney2(received.openAmountKc + issued.openAmountKc),
    overdueDocuments,
    overdueInvoices,
    overdueTotal: overdueTargets.length,
    overdueTargets,
  };
}

/** Alias pro server / API — stejná logika jako computePortalPaymentOverviewStats. */
export function calculateDocumentPaymentSummary(
  documents: CompanyDocumentPaymentRow[] | null | undefined,
  invoices: Array<Record<string, unknown> & { id: string }> | null | undefined,
  todayIso: string
): PortalPaymentOverviewStats {
  return computePortalPaymentOverviewStats(documents, invoices, todayIso);
}
