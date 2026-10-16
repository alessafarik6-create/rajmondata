import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { companyDocToPreliminaryDealProfile } from "@/lib/leads/preliminary-deal-export";
import type { PreliminaryDealCompanyProfile } from "@/lib/leads/preliminary-deal-export";
import { formatCurrency } from "@/lib/pdf/exportJobsToPdf";
import { PDF_FONT_FAMILY } from "@/lib/pdf/register-dejavu-font";
import { registerDejaVuFontsForPdfSync } from "@/lib/pdf/register-dejavu-font-server";
import type { ReceivablesExportRow } from "@/lib/documents/receivables-payables-export";

const MARGIN = 14;
const ORANGE: [number, number, number] = [234, 88, 12];
const NAVY: [number, number, number] = [15, 23, 42];
const HEAD_GRAY: [number, number, number] = [241, 245, 249];

export type LedgerCurrencySummary = {
  currency: string;
  receivables: {
    total: number;
    paid: number;
    remaining: number;
    overdueRemaining: number;
  };
  payables: {
    total: number;
    paid: number;
    remaining: number;
    overdueRemaining: number;
  };
};

export function summarizeLedgerByCurrency(rows: ReceivablesExportRow[]): LedgerCurrencySummary[] {
  const map = new Map<string, LedgerCurrencySummary>();
  for (const r of rows) {
    const cur = r.currency || "CZK";
    let entry = map.get(cur);
    if (!entry) {
      entry = {
        currency: cur,
        receivables: { total: 0, paid: 0, remaining: 0, overdueRemaining: 0 },
        payables: { total: 0, paid: 0, remaining: 0, overdueRemaining: 0 },
      };
      map.set(cur, entry);
    }
    const bucket = r.kind === "receivable" ? entry.receivables : entry.payables;
    bucket.total += r.totalAmount;
    bucket.paid += r.paidAmount;
    bucket.remaining += r.remainingAmount;
    if (r.overdueDays > 0 && r.remainingAmount > 0.009) {
      bucket.overdueRemaining += r.remainingAmount;
    }
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

function formatMoney(amount: number, currency: string): string {
  const n = Math.round(amount * 100) / 100;
  if (currency === "CZK") return formatCurrency(n);
  return `${n.toLocaleString("cs-CZ")} ${currency}`;
}

function addFooters(doc: jsPDF, orgName: string, generatedAt: Date): void {
  const pages = doc.getNumberOfPages();
  const h = doc.internal.pageSize.getHeight();
  const w = doc.internal.pageSize.getWidth();
  const stamp = generatedAt.toLocaleString("cs-CZ");
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("RAJMONDATA.cz", MARGIN, h - 8);
    doc.text(`Export: ${stamp}`, MARGIN, h - 4);
    doc.text(orgName, w / 2, h - 4, { align: "center" });
    doc.text(`Strana ${i} / ${pages}`, w - MARGIN, h - 4, { align: "right" });
  }
  doc.setTextColor(...NAVY);
}

function drawLetterhead(
  doc: jsPDF,
  profile: PreliminaryDealCompanyProfile,
  title: string,
  periodLabel: string,
  generatedAt: Date
): number {
  const w = doc.internal.pageSize.getWidth();
  let y = MARGIN;
  const textX = profile.logoDataUrl ? MARGIN + 26 : MARGIN;
  if (profile.logoDataUrl) {
    try {
      const fmt = profile.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addImage(profile.logoDataUrl, fmt, MARGIN, y, 22, 22);
    } catch {
      /* optional */
    }
  }
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...NAVY);
  doc.text(profile.name, textX, y + 6);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  let ly = y + 11;
  const lines: string[] = [];
  if (profile.address) lines.push(...profile.address.split("\n"));
  if (profile.ico) lines.push(`IČO: ${profile.ico}`);
  if (profile.dic) lines.push(`DIČ: ${profile.dic}`);
  if (profile.phone) lines.push(`Tel.: ${profile.phone}`);
  if (profile.email) lines.push(profile.email);
  for (const line of lines.slice(0, 6)) {
    doc.text(line, textX, ly);
    ly += 4.2;
  }
  doc.text(
    `Datum exportu: ${generatedAt.toLocaleDateString("cs-CZ")}`,
    w - MARGIN,
    y + 5,
    { align: "right" }
  );
  y = Math.max(y + 24, ly + 2);
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, y, w - MARGIN, y);
  y += 8;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...ORANGE);
  doc.text(title, MARGIN, y);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Období: ${periodLabel}`, MARGIN, y + 6);
  doc.setTextColor(...NAVY);
  return y + 14;
}

function drawSummaryBlock(
  doc: jsPDF,
  y: number,
  summaries: LedgerCurrencySummary[]
): number {
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  doc.text("Finanční přehled", MARGIN, y);
  y += 7;
  for (const s of summaries) {
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(10);
    doc.text(`Měna: ${s.currency}`, MARGIN, y);
    y += 5;
    const cols: [string, string][] = [
      ["POHLEDÁVKY — celkem k úhradě", formatMoney(s.receivables.total, s.currency)],
      ["POHLEDÁVKY — uhrazeno", formatMoney(s.receivables.paid, s.currency)],
      ["POHLEDÁVKY — zbývá uhradit", formatMoney(s.receivables.remaining, s.currency)],
      ["POHLEDÁVKY — po splatnosti", formatMoney(s.receivables.overdueRemaining, s.currency)],
      ["ZÁVAZKY — celkem k úhradě", formatMoney(s.payables.total, s.currency)],
      ["ZÁVAZKY — uhrazeno", formatMoney(s.payables.paid, s.currency)],
      ["ZÁVAZKY — zbývá uhradit", formatMoney(s.payables.remaining, s.currency)],
      ["ZÁVAZKY — po splatnosti", formatMoney(s.payables.overdueRemaining, s.currency)],
    ];
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(9);
    for (const [label, value] of cols) {
      doc.text(label, MARGIN + 2, y);
      doc.text(value, MARGIN + 95, y);
      y += 4.5;
    }
    const net = s.receivables.remaining - s.payables.remaining;
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.text("Čistý rozdíl (neuhrazené pohledávky − závazky)", MARGIN + 2, y);
    doc.text(formatMoney(net, s.currency), MARGIN + 95, y);
    y += 8;
  }
  return y;
}

function statusCellStyle(row: ReceivablesExportRow): Partial<{ textColor: [number, number, number]; fontStyle: "bold" | "normal" }> {
  if (row.statusLabel === "Uhrazeno") return { textColor: [22, 163, 74] };
  if (row.overdueDays > 0 && row.remainingAmount > 0.009) return { textColor: [220, 38, 38], fontStyle: "bold" };
  return {};
}

function drawLedgerTable(
  doc: jsPDF,
  startY: number,
  sectionTitle: string,
  rows: ReceivablesExportRow[],
  partnerHeader: string
): number {
  if (!rows.length) return startY;
  let y = startY;
  if (y > 180) {
    doc.addPage();
    y = MARGIN + 8;
  }
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text(sectionTitle, MARGIN, y);
  doc.setTextColor(...NAVY);
  y += 4;

  const body = rows.map((r) => [
    r.number,
    r.partner,
    r.issuedDate || "—",
    r.dueDate || "—",
    formatMoney(r.totalAmount, r.currency),
    formatMoney(r.paidAmount, r.currency),
    formatMoney(r.remainingAmount, r.currency),
    r.statusLabel,
  ]);

  autoTable(doc, {
    startY: y,
    head: [[
      "Číslo dokladu",
      partnerHeader,
      "Vystavení",
      "Splatnost",
      "Celkem",
      "Uhrazeno",
      "Zbývá",
      "Stav",
    ]],
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: 9.5,
      cellPadding: 2.5,
      overflow: "linebreak",
      valign: "middle",
      textColor: NAVY,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      minCellHeight: 8,
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: HEAD_GRAY,
      textColor: NAVY,
      fontSize: 9.5,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 42 },
      2: { cellWidth: 22 },
      3: { cellWidth: 22 },
      4: { halign: "right", cellWidth: 26 },
      5: { halign: "right", cellWidth: 26 },
      6: { halign: "right", cellWidth: 26 },
      7: { cellWidth: 22 },
    },
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = rows[data.row.index];
      if (!row) return;
      const col = data.column.index;
      if (col === 7) {
        const st = statusCellStyle(row);
        if (st.textColor) data.cell.styles.textColor = st.textColor;
        if (st.fontStyle) data.cell.styles.fontStyle = st.fontStyle;
      }
      if (row.overdueDays > 0 && row.remainingAmount > 0.009 && col === 6) {
        data.cell.styles.textColor = [220, 38, 38];
        data.cell.styles.fontStyle = "bold";
      }
      if (row.statusLabel === "Uhrazeno" && col >= 4 && col <= 6) {
        data.cell.styles.textColor = [22, 163, 74];
      }
    },
  });

  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
}

export async function exportReceivablesPayablesPdfBuffer(input: {
  rows: ReceivablesExportRow[];
  companyDoc: Record<string, unknown>;
  logoDataUrl: string | null;
  orgName: string;
  title: string;
  periodLabel: string;
}): Promise<Buffer> {
  const { rows, orgName, title, periodLabel } = input;
  const receivables = rows.filter((r) => r.kind === "receivable");
  const payables = rows.filter((r) => r.kind === "payable");
  const useLandscape = rows.length > 25 || receivables.length + payables.length > 20;

  const doc = new jsPDF({
    orientation: useLandscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  registerDejaVuFontsForPdfSync(doc);
  const generatedAt = new Date();
  const profile = companyDocToPreliminaryDealProfile(input.companyDoc, input.logoDataUrl);

  let y = drawLetterhead(doc, profile, title, periodLabel, generatedAt);
  const summaries = summarizeLedgerByCurrency(rows);
  y = drawSummaryBlock(doc, y, summaries);
  y += 4;

  if (receivables.length) {
    y = drawLedgerTable(doc, y, "Pohledávky", receivables, "Odběratel");
    y += 6;
  }
  if (payables.length) {
    y = drawLedgerTable(doc, y, "Závazky", payables, "Dodavatel");
  }

  addFooters(doc, orgName, generatedAt);
  return Buffer.from(doc.output("arraybuffer"));
}
