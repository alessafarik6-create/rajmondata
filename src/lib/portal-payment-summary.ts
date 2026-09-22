/**
 * Souhrn plateb — přijaté (k úhradě) a vydané (k inkasu) odděleně, zbývající částky s DPH.
 */

import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  documentClassificationValues,
  documentRemainingForPayment,
  getDocumentPaymentUrgency,
  getPortalInvoicePaymentUrgency,
  isCompanyDocumentDeliveryNote,
  isDocumentEligibleForPaymentBox,
  isPortalInvoiceOpenForCollection,
  portalInvoiceRemaining,
  type CompanyDocumentPaymentRow,
} from "@/lib/company-document-payment";
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
  const out: PortalPaymentOverdueTarget[] = [];
  for (const d of financialActive) {
    if (isPortalInvoiceMirrorDocument(d)) continue;
    if (documentRemainingForPayment(d) <= 0) continue;
    if (getDocumentPaymentUrgency(d, todayIso) !== "overdue") continue;
    const sec = paymentSectionForDoc(d);
    if (!sec) continue;
    out.push({
      flashRowKey: `doc:${String(d.id ?? "")}`,
      due: String(d.dueDate ?? "").trim() || "9999-12-31",
      section: sec,
    });
  }
  for (const inv of invoices) {
    if (!isPortalInvoiceOpenForCollection(inv)) continue;
    if (getPortalInvoicePaymentUrgency(inv, todayIso) !== "overdue") continue;
    out.push({
      flashRowKey: `inv:${inv.id}`,
      due: String(inv.dueDate ?? "").trim() || "9999-12-31",
      section: "issued",
    });
  }
  out.sort(
    (a, b) =>
      a.due.localeCompare(b.due) || a.flashRowKey.localeCompare(b.flashRowKey)
  );
  return out;
}

function addDocToSide(
  side: PortalPaymentSideStats,
  remaining: number,
  isOverdue: boolean
): void {
  side.openCount += 1;
  side.openAmountKc = roundMoney2(side.openAmountKc + remaining);
  if (isOverdue) {
    side.overdueCount += 1;
    side.overdueAmountKc = roundMoney2(side.overdueAmountKc + remaining);
  }
}

export function computePortalPaymentOverviewStats(
  documents: CompanyDocumentPaymentRow[] | null | undefined,
  invoices: Array<Record<string, unknown> & { id: string }> | null | undefined,
  todayIso: string
): PortalPaymentOverviewStats {
  const financialActive = filterActiveFinancialDocuments(documents);
  const invList = filterActivePortalInvoices(invoices);

  const received: PortalPaymentSideStats = { ...EMPTY_SIDE };
  const issued: PortalPaymentSideStats = { ...EMPTY_SIDE };

  for (const d of financialActive) {
    if (isPortalInvoiceMirrorDocument(d)) continue;
    if (!isDocumentEligibleForPaymentBox(d)) continue;
    const section = paymentSectionForDoc(d);
    if (!section) continue;
    const remaining = documentRemainingForPayment(d);
    if (remaining <= 0) continue;
    const overdue = getDocumentPaymentUrgency(d, todayIso) === "overdue";
    if (section === "received") {
      addDocToSide(received, remaining, overdue);
    } else {
      addDocToSide(issued, remaining, overdue);
    }
  }

  for (const inv of invList) {
    if (!isPortalInvoiceOpenForCollection(inv)) continue;
    const remaining = portalInvoiceRemaining(inv);
    if (remaining <= 0) continue;
    const overdue = getPortalInvoicePaymentUrgency(inv, todayIso) === "overdue";
    addDocToSide(issued, remaining, overdue);
  }

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
