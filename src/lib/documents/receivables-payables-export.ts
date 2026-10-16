import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  getDocumentPaymentState,
  getPortalInvoicePaymentState,
  isPortalInvoiceExcludedFromPaymentSummary,
  type PaymentStateRow,
} from "@/lib/invoice-payment-state";

export type LedgerExportKind = "receivable" | "payable";

export type ReceivablesExportFilters = {
  scope: "receivables" | "payables" | "both";
  dateField: "issued" | "due";
  dateFrom?: string | null;
  dateTo?: string | null;
  paymentStatus?: "all" | "paid" | "partial" | "unpaid" | "overdue";
  partnerQuery?: string | null;
  jobId?: string | null;
  currency?: string | null;
};

export type ReceivablesExportRow = {
  kind: LedgerExportKind;
  number: string;
  partner: string;
  ico: string;
  issuedDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  statusLabel: string;
  overdueDays: number;
  jobLabel: string;
  currency: string;
};

function isReceivedDocument(row: Record<string, unknown>): boolean {
  if (row.documentType === "delivery_note") return true;
  const type = String(row.type ?? "").toLowerCase();
  const kind = String(row.documentKind ?? "").toLowerCase();
  return (
    type === "received" ||
    kind === "prijate" ||
    (type !== "issued" && type !== "vydane" && kind !== "vydane")
  );
}

function isIssuedDocument(row: Record<string, unknown>): boolean {
  const type = String(row.type ?? "").toLowerCase();
  const kind = String(row.documentKind ?? "").toLowerCase();
  return type === "issued" || type === "vydane" || kind === "vydane";
}

function pickDate(row: Record<string, unknown>, field: "issued" | "due"): string {
  if (field === "due") {
    return String(row.dueDate ?? row.splatnost ?? "").trim().slice(0, 10);
  }
  return String(
    row.issueDate ?? row.datum ?? row.date ?? row.createdAtIso ?? row.invoiceDate ?? ""
  )
    .trim()
    .slice(0, 10);
}

function statusLabel(state: ReturnType<typeof getDocumentPaymentState>): string {
  if (state.isPaid) return "Uhrazeno";
  if (state.isPartiallyPaid) return "Částečně";
  return "Neuhrazeno";
}

function overdueDays(due: string | null, todayIso: string, remaining: number): number {
  if (remaining <= 0 || !due) return 0;
  const diff = Math.floor(
    (Date.parse(todayIso) - Date.parse(due)) / (1000 * 60 * 60 * 24)
  );
  return diff > 0 ? diff : 0;
}

function rowCurrency(row: Record<string, unknown>): string {
  const c = String(row.currency ?? row.mena ?? "CZK").trim().toUpperCase();
  return c || "CZK";
}

function partnerFromDoc(row: Record<string, unknown>): { name: string; ico: string } {
  return {
    name: String(
      row.entityName ?? row.nazev ?? row.supplierName ?? row.customerName ?? row.description ?? ""
    ).trim(),
    ico: String(row.ico ?? row.dic ?? row.partnerIco ?? "").trim(),
  };
}

function matchesFilters(
  row: ReceivablesExportRow,
  filters: ReceivablesExportFilters,
  todayIso: string
): boolean {
  const dateVal = filters.dateField === "due" ? row.dueDate : row.issuedDate;
  if (filters.dateFrom && dateVal && dateVal < filters.dateFrom) return false;
  if (filters.dateTo && dateVal && dateVal > filters.dateTo) return false;
  if (filters.currency && row.currency !== filters.currency.toUpperCase()) return false;
  if (filters.partnerQuery) {
    const q = filters.partnerQuery.toLowerCase();
    if (
      !row.partner.toLowerCase().includes(q) &&
      !row.ico.toLowerCase().includes(q) &&
      !row.number.toLowerCase().includes(q)
    ) {
      return false;
    }
  }
  if (filters.jobId && row.jobLabel !== filters.jobId) return false;
  if (filters.paymentStatus === "paid" && row.remainingAmount > 0.009) return false;
  if (filters.paymentStatus === "unpaid" && row.remainingAmount <= 0.009) return false;
  if (filters.paymentStatus === "partial" && !(row.paidAmount > 0 && row.remainingAmount > 0.009))
    return false;
  if (filters.paymentStatus === "overdue" && row.overdueDays <= 0) return false;
  return true;
}

export function buildReceivablesPayablesExportRows(input: {
  documents: Array<Record<string, unknown> & { id: string }>;
  invoices: Array<Record<string, unknown> & { id: string }>;
  jobNamesById: Record<string, string>;
  todayIso: string;
  filters: ReceivablesExportFilters;
}): ReceivablesExportRow[] {
  const out: ReceivablesExportRow[] = [];
  const { filters, todayIso, jobNamesById } = input;

  for (const doc of input.documents) {
    if (!isActiveFirestoreDoc(doc) || !isFinancialCompanyDocument(doc as Parameters<typeof isFinancialCompanyDocument>[0]))
      continue;
    const received = isReceivedDocument(doc);
    const issued = isIssuedDocument(doc);
    if (filters.scope === "receivables" && !issued) continue;
    if (filters.scope === "payables" && !received) continue;
    const state = getDocumentPaymentState(doc as PaymentStateRow, todayIso);
    const partner = partnerFromDoc(doc);
    const jobId = String(doc.jobId ?? doc.linkedJobId ?? "").trim();
    const row: ReceivablesExportRow = {
      kind: issued ? "receivable" : "payable",
      number: String(doc.number ?? doc.documentNumber ?? doc.id).trim(),
      partner: partner.name,
      ico: partner.ico,
      issuedDate: pickDate(doc, "issued"),
      dueDate: pickDate(doc, "due"),
      totalAmount: state.totalAmount,
      paidAmount: state.paidAmount,
      remainingAmount: state.remainingAmount,
      statusLabel: statusLabel(state),
      overdueDays: overdueDays(state.dueDate, todayIso, state.remainingAmount),
      jobLabel: jobId ? jobNamesById[jobId] ?? jobId : "",
      currency: rowCurrency(doc),
    };
    if (matchesFilters(row, filters, todayIso)) out.push(row);
  }

  for (const inv of input.invoices) {
    if (!isActiveFirestoreDoc(inv) || isPortalInvoiceExcludedFromPaymentSummary(inv as PaymentStateRow))
      continue;
    if (filters.scope === "payables") continue;
    const state = getPortalInvoicePaymentState(inv as PaymentStateRow, todayIso);
    const jobId = String(inv.jobId ?? "").trim();
    const row: ReceivablesExportRow = {
      kind: "receivable",
      number: String(inv.invoiceNumber ?? inv.documentNumber ?? inv.id).trim(),
      partner: String(inv.customerName ?? inv.clientName ?? "").trim(),
      ico: String(inv.customerIco ?? inv.ico ?? "").trim(),
      issuedDate: pickDate(inv, "issued"),
      dueDate: pickDate(inv, "due"),
      totalAmount: state.totalAmount,
      paidAmount: state.paidAmount,
      remainingAmount: state.remainingAmount,
      statusLabel: statusLabel(state),
      overdueDays: overdueDays(state.dueDate, todayIso, state.remainingAmount),
      jobLabel: jobId ? jobNamesById[jobId] ?? jobId : "",
      currency: rowCurrency(inv),
    };
    if (matchesFilters(row, filters, todayIso)) out.push(row);
  }

  return out.sort((a, b) => (b.dueDate || b.issuedDate).localeCompare(a.dueDate || a.issuedDate));
}

function csvEscape(v: string): string {
  if (/[",;\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportRowsToCsvBuffer(rows: ReceivablesExportRow[]): Buffer {
  const header = [
    "Typ",
    "Číslo dokladu",
    "Partner",
    "IČO",
    "Datum vystavení",
    "Datum splatnosti",
    "Celková částka",
    "Uhrazeno",
    "Zbývá uhradit",
    "Stav",
    "Po splatnosti (dny)",
    "Zakázka",
    "Měna",
  ];
  const lines = [
    header.join(";"),
    ...rows.map((r) =>
      [
        r.kind === "receivable" ? "Pohledávka" : "Závazek",
        r.number,
        r.partner,
        r.ico,
        r.issuedDate,
        r.dueDate,
        String(r.totalAmount).replace(".", ","),
        String(r.paidAmount).replace(".", ","),
        String(r.remainingAmount).replace(".", ","),
        r.statusLabel,
        String(r.overdueDays),
        r.jobLabel,
        r.currency,
      ]
        .map((c) => csvEscape(String(c)))
        .join(";")
    ),
  ];
  const body = `\uFEFF${lines.join("\r\n")}`;
  return Buffer.from(body, "utf8");
}

export function exportRowsToXlsxBuffer(rows: ReceivablesExportRow[]): Buffer {
  const sheetRows = rows.map((r) => ({
    Typ: r.kind === "receivable" ? "Pohledávka" : "Závazek",
    "Číslo dokladu": r.number,
    Partner: r.partner,
    IČO: r.ico,
    "Datum vystavení": r.issuedDate,
    "Datum splatnosti": r.dueDate,
    "Celková částka": r.totalAmount,
    Uhrazeno: r.paidAmount,
    "Zbývá uhradit": r.remainingAmount,
    Stav: r.statusLabel,
    "Po splatnosti (dny)": r.overdueDays,
    Zakázka: r.jobLabel,
    Měna: r.currency,
  }));
  const receivables = sheetRows.filter((r) => r.Typ === "Pohledávka");
  const payables = sheetRows.filter((r) => r.Typ === "Závazek");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receivables), "Pohledávky");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payables), "Závazky");
  const summary = summarizeByCurrency(rows);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summary),
    "Souhrn"
  );
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function summarizeByCurrency(rows: ReceivablesExportRow[]) {
  const map = new Map<
    string,
    { currency: string; remaining: number; overdueRemaining: number; count: number }
  >();
  for (const r of rows) {
    const cur = map.get(r.currency) ?? {
      currency: r.currency,
      remaining: 0,
      overdueRemaining: 0,
      count: 0,
    };
    cur.count += 1;
    cur.remaining += r.remainingAmount;
    if (r.overdueDays > 0) cur.overdueRemaining += r.remainingAmount;
    map.set(r.currency, cur);
  }
  return [...map.values()].map((x) => ({
    Měna: x.currency,
    "Počet položek": x.count,
    "Neuhrazeno celkem": Math.round(x.remaining * 100) / 100,
    "Po splatnosti (neuhrazeno)": Math.round(x.overdueRemaining * 100) / 100,
  }));
}

export function exportRowsToPdfBuffer(
  rows: ReceivablesExportRow[],
  orgName: string,
  title: string,
  periodLabel: string
): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  void registerDejaVuFontsForPdf(doc);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(14);
  doc.text(orgName, 14, 16);
  doc.setFontSize(12);
  doc.text(title, 14, 24);
  doc.setFontSize(10);
  doc.text(`Období: ${periodLabel}`, 14, 30);
  doc.text(`Vytvořeno: ${new Date().toLocaleString("cs-CZ")}`, 14, 36);

  autoTable(doc, {
    startY: 42,
    head: [
      [
        "Typ",
        "Číslo",
        "Partner",
        "Vystaveno",
        "Splatnost",
        "Celkem",
        "Uhrazeno",
        "Zbývá",
        "Stav",
        "Dní",
        "Měna",
      ],
    ],
    body: rows.map((r) => [
      r.kind === "receivable" ? "Pohledávka" : "Závazek",
      r.number,
      r.partner,
      r.issuedDate,
      r.dueDate,
      r.totalAmount.toLocaleString("cs-CZ"),
      r.paidAmount.toLocaleString("cs-CZ"),
      r.remainingAmount.toLocaleString("cs-CZ"),
      r.statusLabel,
      String(r.overdueDays),
      r.currency,
    ]),
    styles: { font: PDF_FONT_FAMILY, fontSize: 8 },
    headStyles: { font: PDF_FONT_FAMILY },
  });

  const summary = summarizeByCurrency(rows);
  let y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 42;
  y += 8;
  doc.setFontSize(10);
  doc.text("Souhrn podle měn (neuhrazené zůstatky)", 14, y);
  y += 4;
  for (const s of summary) {
    y += 6;
    doc.text(
      `${s.Měna}: neuhrazeno ${s["Neuhrazeno celkem"]}, po splatnosti ${s["Po splatnosti (neuhrazeno)"]}`,
      14,
      y
    );
  }

  return Buffer.from(doc.output("arraybuffer"));
}
