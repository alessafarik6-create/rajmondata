/**
 * Mapování faktur / dokladů na typ e-mailu a předmět (klient + server).
 */

import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import {
  DOCUMENT_EMAIL_TYPE_LABELS,
  type DocumentEmailType,
} from "@/lib/document-email-outbound";
import { PORTAL_MANUAL_INVOICE_TYPE } from "@/lib/portal-manual-invoice";

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

export function invoiceDocTypeLabelCs(inv: Record<string, unknown>): string {
  const t = trim(inv.type);
  if (t === JOB_INVOICE_TYPES.ADVANCE) return "Zálohová faktura";
  if (t === JOB_INVOICE_TYPES.TAX_RECEIPT) return "Daňový doklad";
  if (t === JOB_INVOICE_TYPES.FINAL_INVOICE) return "Vyúčtovací faktura";
  if (t === PORTAL_MANUAL_INVOICE_TYPE) return "Faktura";
  return "Doklad";
}

export function resolveInvoiceDocumentEmailType(
  inv: Record<string, unknown>
): DocumentEmailType {
  const t = trim(inv.type);
  if (t === JOB_INVOICE_TYPES.ADVANCE) return "advance_invoice";
  return "invoice";
}

export function invoiceDocumentEmailSubject(inv: Record<string, unknown>): string {
  const num = trim(inv.invoiceNumber) || trim(inv.documentNumber) || trim(inv.id) || "doklad";
  return `${invoiceDocTypeLabelCs(inv)} — ${num}`;
}

export function companyDocumentEmailSubject(
  row: Record<string, unknown>,
  kind: "received" | "issued"
): string {
  const num =
    trim(row.number) ||
    trim(row.nazev) ||
    trim(row.entityName) ||
    trim(row.fileName) ||
    trim(row.id) ||
    "doklad";
  const label =
    kind === "issued"
      ? trim(row.documentType) === "delivery_note"
        ? "Dodací list"
        : "Vydaný doklad"
      : "Přijatý doklad";
  return `${label} — ${num}`;
}

export function documentEmailTypeLabel(type: DocumentEmailType): string {
  return DOCUMENT_EMAIL_TYPE_LABELS[type] ?? type;
}
