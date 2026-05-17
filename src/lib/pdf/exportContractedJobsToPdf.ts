/**
 * PDF export zesmluvněných zakázek (landscape, čitelné sloupce, souhrn).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import {
  type ContractedJobExportRow,
  type ContractedJobsExportSummary,
  type ContractedJobsPaidVatGroup,
} from "@/lib/contracted-jobs-export";
import { formatMoneyKc, paymentStatusLabelCs } from "@/lib/job-payment-summary";
import { formatCurrency } from "@/lib/pdf/exportJobsToPdf";

export type ExportContractedJobsToPdfOptions = {
  rows: ContractedJobExportRow[];
  summary: ContractedJobsExportSummary;
  companyName: string;
  logoDataUrl?: string | null;
  fileName?: string;
  fontBasePath?: string;
};

/**
 * Spodní souhrn PDF — bez součtu požadovaných záloh (sloupec Záloha v tabulce zůstává).
 */
export function buildContractedJobsPdfSummaryLines(
  summary: ContractedJobsExportSummary
): string[] {
  return [
    `Počet zesmluvněných zakázek: ${summary.jobCount}`,
    `Součet cen zakázek: ${formatMoneyKc(summary.totalPriceGross)}`,
    `Součet celkem zaplaceno: ${formatMoneyKc(summary.totalReceivedDepositGross)}`,
    `Součet zbývá doplatit: ${formatMoneyKc(summary.totalRemainingToPayGross)}`,
  ];
}

function safeCellText(s: string | null | undefined): string {
  if (s == null) return "—";
  const t = String(s).trim();
  return t.length ? t : "—";
}

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  return "JPEG";
}

function ensurePageSpace(
  doc: jsPDF,
  footY: number,
  pageH: number,
  neededMm: number
): number {
  if (footY + neededMm <= pageH - 10) return footY;
  doc.addPage();
  return 14;
}

function renderPaidVatSummaryBlock(
  doc: jsPDF,
  margin: number,
  pageH: number,
  startY: number,
  groups: ContractedJobsPaidVatGroup[]
): number {
  const visible = groups.filter((g) => g.amountGross > 0.009);
  if (visible.length === 0) return startY;

  const blockHeight = 8 + visible.length * 14;
  let footY = ensurePageSpace(doc, startY, pageH, blockHeight);
  footY += 5;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 15, 20);
  doc.text("Souhrn přijatých plateb podle DPH:", margin, footY);
  footY += 5;

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(35, 35, 45);

  for (const g of visible) {
    footY = ensurePageSpace(doc, footY, pageH, 14);
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.text(g.title, margin, footY);
    footY += 3.5;
    doc.setFont(PDF_FONT_FAMILY, "normal");
    const lines = [
      `Základ bez DPH: ${formatMoneyKc(g.amountNet)}`,
      `DPH: ${formatMoneyKc(g.vatAmount)}`,
      `Celkem s DPH: ${formatMoneyKc(g.amountGross)}`,
    ];
    for (const line of lines) {
      doc.text(line, margin + 2, footY);
      footY += 3.2;
    }
    footY += 2;
  }

  return footY;
}

export async function exportContractedJobsToPdf(
  options: ExportContractedJobsToPdfOptions
): Promise<void> {
  const { rows, summary, companyName } = options;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, options.fontBasePath ?? "/fonts");

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  let cursorY = 12;

  if (options.logoDataUrl) {
    const fmt = detectImageFormat(options.logoDataUrl);
    try {
      doc.addImage(options.logoDataUrl, fmt, margin, cursorY, 14, 14);
    } catch {
      /* bez loga */
    }
  }

  const titleX = options.logoDataUrl ? margin + 18 : margin;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(13);
  doc.setTextColor(24, 24, 27);
  doc.text(companyName || "Organizace", titleX, cursorY + 5);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(55, 55, 65);
  doc.text(
    `Export: ${new Date().toLocaleString("cs-CZ")}`,
    pageW - margin,
    cursorY + 4,
    { align: "right" }
  );
  cursorY += 16;
  doc.setFontSize(10);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setTextColor(15, 15, 20);
  doc.text("Přehled zesmluvněných zakázek", margin, cursorY);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  cursorY += 4;

  const head = [
    [
      "Číslo",
      "Zakázka",
      "Zákazník",
      "Adresa",
      "Vytvořeno",
      "Zesmluvněno",
      "Smlouva/SOD",
      "Cena",
      "Záloha",
      "Ručně",
      "Z plateb",
      "Celkem zaplaceno",
      "Zbývá doplatit",
      "Stav zálohy",
      "Stav zakázky",
      "Datumy plateb",
    ],
  ];

  const body = rows.map((r) => [
    safeCellText(r.jobNumber),
    safeCellText(r.jobName),
    safeCellText(r.customer),
    safeCellText(r.address),
    safeCellText(r.createdAtLabel),
    safeCellText(r.contractedDisplayValue || r.contractedAtLabel),
    safeCellText(r.contractNumber),
    formatCurrency(r.totalPriceGross),
    formatCurrency(r.requiredDepositGross),
    formatCurrency(r.manualDepositGross),
    formatCurrency(r.paymentsDepositGross),
    formatCurrency(r.totalPaidGross),
    formatCurrency(r.remainingToPayGross),
    paymentStatusLabelCs(r.depositStatus),
    paymentStatusLabelCs(r.jobPaymentStatus),
    safeCellText(r.depositPaymentDatesLabel),
  ]);

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
      fontSize: 5.5,
      cellPadding: 1,
      overflow: "linebreak",
      valign: "top",
      textColor: [20, 20, 28],
      lineColor: [200, 200, 210],
      lineWidth: 0.06,
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: [220, 95, 20],
      textColor: [255, 255, 255],
      halign: "left",
      fontSize: 5.5,
    },
    alternateRowStyles: { fillColor: [252, 252, 254] },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 16 },
      2: { cellWidth: 14 },
      3: { cellWidth: 18 },
      4: { cellWidth: 12 },
      5: { cellWidth: 12 },
      6: { cellWidth: 12 },
      7: { halign: "right", cellWidth: 13 },
      8: { halign: "right", cellWidth: 11 },
      9: { halign: "right", cellWidth: 11 },
      10: { halign: "right", cellWidth: 11 },
      11: { halign: "right", cellWidth: 13 },
      12: { halign: "right", cellWidth: 13 },
      13: { cellWidth: 12 },
      14: { cellWidth: 12 },
      15: { cellWidth: 20 },
    },
    margin: { left: margin, right: margin },
    tableWidth: pageW - 2 * margin,
  });

  let footY =
    (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
    cursorY + 20;

  const rowsWithOther = rows.filter(
    (r) => r.otherPaymentsLabel && r.otherPaymentsLabel !== "—"
  );
  if (rowsWithOther.length > 0) {
    if (footY > pageH - 50) {
      doc.addPage();
      footY = 14;
    }
    footY += 5;
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(7.5);
    doc.text("Ostatní přijaté platby (bez vazby na zálohovou fakturu)", margin, footY);
    footY += 3.5;
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(6.5);
    for (const r of rowsWithOther) {
      if (footY > pageH - 18) {
        doc.addPage();
        footY = 14;
      }
      const line = `${r.jobName}: ${r.otherPaymentsLabel}`;
      const split = doc.splitTextToSize(line, pageW - 2 * margin);
      doc.text(split, margin, footY);
      footY += split.length * 3.2 + 1;
    }
  }

  if (footY > pageH - 40) {
    doc.addPage();
    footY = 14;
  }
  footY += 6;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(9.5);
  doc.text("Souhrn", margin, footY);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  footY += 4.5;
  doc.setFontSize(8);
  const summaryLines = buildContractedJobsPdfSummaryLines(summary);
  for (const line of summaryLines) {
    doc.text(line, margin, footY);
    footY += 4;
  }

  footY = renderPaidVatSummaryBlock(
    doc,
    margin,
    pageH,
    footY + 2,
    summary.paidByVatGroups ?? []
  );

  const safeName = (
    options.fileName ||
    `zesmluvnene-zakazky-${new Date().toISOString().slice(0, 10)}`
  )
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_");
  doc.save(`${safeName}.pdf`);
}
