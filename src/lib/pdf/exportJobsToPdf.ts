/**
 * Export přehledu zakázek do PDF (jsPDF + autoTable + DejaVu Sans / Identity-H).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";

/** Bezpečně převede vstup na částku v Kč (chybějící → 0 Kč). */
export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "0 Kč";
  }
  if (typeof value === "string") {
    const t = value.replace(/\s/g, "").replace(/Kč/gi, "").replace(/\u00a0/g, "").trim();
    if (t === "" || t === "—") return "0 Kč";
    const normalized = t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(normalized);
    if (!Number.isFinite(n)) return "0 Kč";
    return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return "0 Kč";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

export type JobPdfExportRow = {
  jobName: string;
  customer: string;
  statusLabel: string;
  /** Hrubý rozpočet (Kč); chybí-li ve zdroji → 0. */
  budgetGross: number;
  costsGross: number;
  remainingGross: number;
  vatPercentLabel: string;
  periodLabel: string;
};

export type ExportJobsToPdfOptions = {
  jobs: JobPdfExportRow[];
  companyName: string;
  logoDataUrl?: string | null;
  fileName?: string;
  /** Kořen pro /fonts/DejaVu*.ttf (výchozí /fonts). */
  fontBasePath?: string;
};

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  return "JPEG";
}

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function safeCellText(s: string | null | undefined): string {
  if (s == null) return "—";
  const t = String(s).trim();
  return t.length ? t : "—";
}

/**
 * Vygeneruje PDF a spustí stažení v prohlížeči.
 */
export async function exportJobsToPdf(options: ExportJobsToPdfOptions): Promise<void> {
  const { jobs, companyName } = options;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, options.fontBasePath ?? "/fonts");

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let cursorY = 14;

  if (options.logoDataUrl) {
    const fmt = detectImageFormat(options.logoDataUrl);
    try {
      doc.addImage(options.logoDataUrl, fmt, margin, cursorY, 18, 18);
    } catch {
      try {
        doc.addImage(options.logoDataUrl, fmt === "PNG" ? "JPEG" : "PNG", margin, cursorY, 18, 18);
      } catch {
        /* bez loga */
      }
    }
  }

  const titleX = options.logoDataUrl ? margin + 22 : margin;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(15);
  doc.setTextColor(24, 24, 27);
  doc.text(companyName || "Organizace", titleX, cursorY + 7);

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.setTextColor(55, 55, 65);
  doc.text(
    `Datum exportu: ${new Date().toLocaleString("cs-CZ")}`,
    pageW - margin,
    cursorY + 5,
    { align: "right" }
  );

  cursorY += 22;
  doc.setFontSize(12);
  doc.setTextColor(15, 15, 20);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.text("Přehled zakázek", margin, cursorY);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  cursorY += 6;

  const head = [
    [
      "Zakázka",
      "Zákazník",
      "Stav",
      "Rozpočet",
      "Náklady",
      "Zbývá",
      "DPH",
      "Období",
    ],
  ];

  const body = jobs.map((j) => [
    safeCellText(j.jobName),
    safeCellText(j.customer),
    safeCellText(j.statusLabel),
    formatCurrency(j.budgetGross),
    formatCurrency(j.costsGross),
    formatCurrency(j.remainingGross),
    safeCellText(j.vatPercentLabel || "0 %"),
    safeCellText(j.periodLabel),
  ]);

  const totalBudget = jobs.reduce((s, j) => s + (Number(j.budgetGross) || 0), 0);
  const totalCosts = jobs.reduce((s, j) => s + (Number(j.costsGross) || 0), 0);
  const totalRemaining = jobs.reduce((s, j) => s + (Number(j.remainingGross) || 0), 0);
  const withBudget = jobs.filter((j) => (Number(j.budgetGross) || 0) > 0).length;

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
      fontSize: 8,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "top",
      textColor: [20, 20, 28],
      lineColor: [200, 200, 210],
      lineWidth: 0.1,
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: [220, 95, 20],
      textColor: [255, 255, 255],
      halign: "left",
      fontSize: 8,
    },
    bodyStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
      textColor: [20, 20, 28],
    },
    alternateRowStyles: {
      fillColor: [252, 252, 254],
    },
    columnStyles: {
      0: { cellWidth: 44 },
      1: { cellWidth: 36 },
      2: { cellWidth: 22 },
      3: { halign: "right", cellWidth: 30 },
      4: { halign: "right", cellWidth: 30 },
      5: { halign: "right", cellWidth: 30 },
      6: { halign: "center", cellWidth: 16 },
      7: { cellWidth: 34 },
    },
    margin: { left: margin, right: margin },
    tableWidth: pageW - 2 * margin,
  });

  const finalY = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 40;
  let footY = finalY + 10;

  if (footY > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    footY = 20;
    doc.setFont(PDF_FONT_FAMILY, "normal");
  }

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 15, 20);
  doc.text("Souhrn", margin, footY);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  footY += 6;
  doc.setFontSize(9);
  doc.text(
    `Počet zakázek v exportu: ${jobs.length}` +
      (withBudget < jobs.length ? ` (s vyplněným rozpočtem: ${withBudget})` : ""),
    margin,
    footY
  );
  footY += 5;
  doc.text(`Celkový rozpočet (hrubý, kde je uveden): ${formatCurrency(totalBudget)}`, margin, footY);
  footY += 5;
  doc.text(`Celkové náklady (hrubé): ${formatCurrency(totalCosts)}`, margin, footY);
  footY += 5;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.text(`Celkem zbývá (součet řádků): ${formatCurrency(totalRemaining)}`, margin, footY);

  const safeName = (options.fileName || `prehled-zakazek-${new Date().toISOString().slice(0, 10)}`)
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_");
  doc.save(`${safeName}.pdf`);
}
