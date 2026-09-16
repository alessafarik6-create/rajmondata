/**
 * Jednotný souhrn „k úhradě“ — pouze aktivní doklady/faktury, bez dvojího započtení zrcadlených faktur.
 */

import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  documentGrossForPayment,
  getDocumentPaymentUrgency,
  getPortalInvoicePaymentUrgency,
  isDocumentEligibleForPaymentBox,
  type CompanyDocumentPaymentRow,
} from "@/lib/company-document-payment";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { roundMoney2 } from "@/lib/vat-calculations";

export type PortalPaymentOverdueTarget = {
  flashRowKey: string;
  due: string;
  section: "received" | "issued";
};

export type PortalPaymentOverviewStats = {
  toPay: number;
  overdueDocuments: number;
  overdueInvoices: number;
  overdueTotal: number;
  totalKc: number;
  overdueTargets: PortalPaymentOverdueTarget[];
};

function isDeliveryNoteRow(row: CompanyDocumentPaymentRow): boolean {
  return (
    row.documentType === "delivery_note" ||
    row.type === "delivery_note" ||
    (row as { documentKind?: string }).documentKind === "delivery_note"
  );
}

function isFinancialOrDeliveryDoc(row: CompanyDocumentPaymentRow): boolean {
  return isFinancialCompanyDocument(row) || isDeliveryNoteRow(row);
}

/** Zrcadlo vystavené faktury v documents — počítá se jen v kolekci invoices. */
export function isPortalInvoiceMirrorDocument(row: CompanyDocumentPaymentRow): boolean {
  const src = String(
    (row as { sourceInvoiceId?: unknown }).sourceInvoiceId ??
      (row as { invoiceId?: unknown }).invoiceId ??
      ""
  ).trim();
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

export function collectOverduePaymentFlashTargets(
  financialActive: CompanyDocumentPaymentRow[],
  invoices: Array<Record<string, unknown> & { id: string }>,
  todayIso: string
): PortalPaymentOverdueTarget[] {
  const out: PortalPaymentOverdueTarget[] = [];
  for (const d of financialActive) {
    if (isPortalInvoiceMirrorDocument(d)) continue;
    const pr = d as CompanyDocumentPaymentRow;
    if (getDocumentPaymentUrgency(pr, todayIso) !== "overdue") continue;
    const sec = overdueSectionForDoc(d);
    if (!sec) continue;
    out.push({
      flashRowKey: `doc:${String(d.id ?? "")}`,
      due: String(d.dueDate ?? "").trim() || "9999-12-31",
      section: sec,
    });
  }
  for (const inv of invoices) {
    if (!isActiveFirestoreDoc(inv)) continue;
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

function overdueSectionForDoc(
  d: CompanyDocumentPaymentRow
): "received" | "issued" | null {
  if (
    d.type === "received" ||
    d.type === "prijate" ||
    d.documentKind === "prijate"
  ) {
    return "received";
  }
  if (
    d.type === "issued" ||
    d.type === "vydane" ||
    d.documentKind === "vydane"
  ) {
    return "issued";
  }
  return null;
}

export function computePortalPaymentOverviewStats(
  documents: CompanyDocumentPaymentRow[] | null | undefined,
  invoices: Array<Record<string, unknown> & { id: string }> | null | undefined,
  todayIso: string
): PortalPaymentOverviewStats {
  const financialActive = filterActiveFinancialDocuments(documents);
  const invList = filterActivePortalInvoices(invoices);

  let toPay = 0;
  let totalKc = 0;

  for (const d of financialActive) {
    if (isPortalInvoiceMirrorDocument(d)) continue;
    if (!isDocumentEligibleForPaymentBox(d)) continue;
    toPay += 1;
    totalKc += documentGrossForPayment(d);
  }

  for (const inv of invList) {
    if (String(inv.status ?? "").trim().toLowerCase() === "paid") continue;
    const gross = Number(inv.amountGross ?? inv.totalAmount ?? 0);
    if (!Number.isFinite(gross) || gross <= 0) continue;
    toPay += 1;
    totalKc += roundMoney2(gross);
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
    toPay,
    overdueDocuments,
    overdueInvoices,
    overdueTotal: overdueTargets.length,
    totalKc: roundMoney2(totalKc),
    overdueTargets,
  };
}
