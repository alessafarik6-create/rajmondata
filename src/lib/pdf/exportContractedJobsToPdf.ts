/**
 * PDF export zesmluvněných zakázek (landscape, čitelné sloupce, souhrn).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import {
  formatMoneyKc,
  type ContractedJobExportRow,
  type ContractedJobsExportSummary,
} from "@/lib/contracted-jobs-export";
import { formatCurrency } from "@/lib/pdf/exportJobsToPdf";

export type ExportContractedJobsToPdfOptions = {
  rows: ContractedJobExportRow[];
  summary: ContractedJobsExportSummary;
  companyName: string;
  logoDataUrl?: string | null;
  fileName?: string;
  fontBasePath?: string;
};

function safeCellText(s: string | null | undefined): string {
  if (s == null) return "—";
  const t = String(s).trim();
  return t.length ? t : "—";
}

function depositStatusLabel(status: string): string {
  if (status === "nezaplaceno") return "Nezaplaceno";
  if (status === "částečně zaplaceno") return "Částečně zaplaceno";
  if (status === "zaplaceno") return "Zaplaceno";
  return "—";
}

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  return "JPEG";
}

export async function exportContractedJobsToPdf(
  options: ExportContractedJobsToPdfOptions
): Promise<void> {
  const { rows, summary, companyName } = options;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, options.fontBasePath ?? "/fonts");

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  let cursorY = 12;

  if (options.logoDataUrl) {
    const fmt = detectImageFormat(options.logoDataUrl);
    try {
      doc.addImage(options.logoDataUrl, fmt, margin, cursorY, 16, 16);
    } catch {
      /* bez loga */
    }
  }

  const titleX = options.logoDataUrl ? margin + 20 : margin;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(14);
  doc.setTextColor(24, 24, 27);
  doc.text(companyName || "Organizace", titleX, cursorY + 6);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8);
  doc.setTextColor(55, 55, 65);
  doc.text(
    `Export: ${new Date().toLocaleString("cs-CZ")}`,
    pageW - margin,
    cursorY + 4,
    { align: "right" }
  );
  cursorY += 18;
  doc.setFontSize(11);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setTextColor(15, 15, 20);
  doc.text("Přehled zesmluvněných zakázek", margin, cursorY);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  cursorY += 5;

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
      "Záloha dle sml.",
      "Přij. zálohy",
      "Datumy plateb",
      "Zbývá záloha",
      "Stav zálohy",
    ],
  ];

  const body = rows.map((r) => [
    safeCellText(r.jobNumber),
    safeCellText(r.jobName),
    safeCellText(r.customer),
    safeCellText(r.address),
    safeCellText(r.createdAtLabel),
    safeCellText(r.contractedAtLabel),
    safeCellText(r.contractNumber),
    formatCurrency(r.totalPriceGross),
    formatCurrency(r.requiredDepositGross),
    formatCurrency(r.receivedDepositGross),
    safeCellText(r.depositPaymentDatesLabel),
    formatCurrency(r.depositRemainingGross),
    depositStatusLabel(r.depositStatus),
  ]);

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
      fontSize: 6.5,
      cellPadding: 1.2,
      overflow: "linebreak",
      valign: "top",
      textColor: [20, 20, 28],
      lineColor: [200, 200, 210],
      lineWidth: 0.08,
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: [220, 95, 20],
      textColor: [255, 255, 255],
      halign: "left",
      fontSize: 6.5,
    },
    alternateRowStyles: { fillColor: [252, 252, 254] },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 22 },
      2: { cellWidth: 20 },
      3: { cellWidth: 26 },
      4: { cellWidth: 16 },
      5: { cellWidth: 16 },
      6: { cellWidth: 16 },
      7: { halign: "right", cellWidth: 16 },
      8: { halign: "right", cellWidth: 16 },
      9: { halign: "right", cellWidth: 16 },
      10: { cellWidth: 28 },
      11: { halign: "right", cellWidth: 16 },
      12: { cellWidth: 18 },
    },
    margin: { left: margin, right: margin },
    tableWidth: pageW - 2 * margin,
    didDrawPage: (data) => {
      if (data.pageNumber > 1) return;
    },
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
      footY = 16;
    }
    footY += 6;
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(8);
    doc.text("Ostatní přijaté platby (bez vazby na zálohovou fakturu)", margin, footY);
    footY += 4;
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(7);
    for (const r of rowsWithOther) {
      if (footY > pageH - 20) {
        doc.addPage();
        footY = 16;
      }
      const line = `${r.jobName}: ${r.otherPaymentsLabel}`;
      const split = doc.splitTextToSize(line, pageW - 2 * margin);
      doc.text(split, margin, footY);
      footY += split.length * 3.5 + 1;
    }
  }

  if (footY > pageH - 36) {
    doc.addPage();
    footY = 16;
  }
  footY += 8;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(10);
  doc.text("Souhrn", margin, footY);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  footY += 5;
  doc.setFontSize(8.5);
  const summaryLines = [
    `Počet zesmluvněných zakázek: ${summary.jobCount}`,
    `Součet celkových cen: ${formatMoneyKc(summary.totalPriceGross)}`,
    `Součet požadovaných záloh: ${formatMoneyKc(summary.totalRequiredDepositGross)}`,
    `Součet přijatých záloh: ${formatMoneyKc(summary.totalReceivedDepositGross)}`,
    `Součet zbývajících záloh k doplacení: ${formatMoneyKc(summary.totalDepositRemainingGross)}`,
  ];
  for (const line of summaryLines) {
    doc.text(line, margin, footY);
    footY += 4.5;
  }

  const safeName = (
    options.fileName ||
    `zesmluvnene-zakazky-${new Date().toISOString().slice(0, 10)}`
  )
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_");
  doc.save(`${safeName}.pdf`);
}
