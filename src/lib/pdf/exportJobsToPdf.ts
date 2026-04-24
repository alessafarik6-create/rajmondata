/**
 * Export přehledu zakázek do PDF (jsPDF + autoTable).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value)).toLocaleString("cs-CZ")} Kč`;
}

export type JobPdfExportRow = {
  jobName: string;
  customer: string;
  statusLabel: string;
  /** Rozpočet včetně DPH (pro srovnání s náklady). */
  budgetGross: number | null;
  /** Náklady včetně DPH (součet expenses). */
  costsGross: number | null;
  /** Zbývá z rozpočtu po nákladech (hrubá částka). */
  remainingGross: number | null;
  /** Např. "21 %" nebo "—". */
  vatPercentLabel: string;
  /** Text do sloupce období (např. zahájení / dokončení). */
  periodLabel: string;
};

export type ExportJobsToPdfOptions = {
  jobs: JobPdfExportRow[];
  companyName: string;
  /** Data URL obrázku (PNG/JPEG), pokud se podařilo načíst. */
  logoDataUrl?: string | null;
  fileName?: string;
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

/**
 * Vygeneruje PDF a spustí stažení v prohlížeči.
 */
export async function exportJobsToPdf(options: ExportJobsToPdfOptions): Promise<void> {
  const { jobs, companyName } = options;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
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
  doc.setFontSize(15);
  doc.setTextColor(24, 24, 27);
  doc.setFont("helvetica", "bold");
  doc.text(companyName || "Organizace", titleX, cursorY + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(82, 82, 91);
  doc.text(
    `Datum exportu: ${new Date().toLocaleString("cs-CZ")}`,
    pageW - margin,
    cursorY + 5,
    { align: "right" }
  );

  cursorY += 22;
  doc.setFontSize(12);
  doc.setTextColor(24, 24, 27);
  doc.setFont("helvetica", "bold");
  doc.text("Přehled zakázek", margin, cursorY);
  doc.setFont("helvetica", "normal");
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
    j.jobName,
    j.customer,
    j.statusLabel,
    formatCurrency(j.budgetGross),
    formatCurrency(j.costsGross),
    formatCurrency(j.remainingGross),
    j.vatPercentLabel,
    j.periodLabel,
  ]);

  const totalBudget = jobs.reduce((s, j) => s + (j.budgetGross ?? 0), 0);
  const totalCosts = jobs.reduce((s, j) => s + (j.costsGross ?? 0), 0);
  const totalRemaining = jobs.reduce((s, j) => s + (j.remainingGross ?? 0), 0);
  const withBudget = jobs.filter((j) => j.budgetGross != null).length;

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    styles: {
      fontSize: 8,
      cellPadding: 1.8,
      overflow: "linebreak",
      valign: "top",
      textColor: [24, 24, 27],
    },
    headStyles: {
      fillColor: [234, 88, 12],
      textColor: 255,
      fontStyle: "bold",
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 38 },
      2: { cellWidth: 24 },
      3: { halign: "right", cellWidth: 26 },
      4: { halign: "right", cellWidth: 26 },
      5: { halign: "right", cellWidth: 26 },
      6: { halign: "center", cellWidth: 14 },
      7: { cellWidth: 32 },
    },
    margin: { left: margin, right: margin },
    tableWidth: pageW - 2 * margin,
  });

  const finalY = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 40;
  let footY = finalY + 10;

  if (footY > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    footY = 20;
  }

  doc.setFontSize(10);
  doc.setTextColor(24, 24, 27);
  doc.setFont("helvetica", "bold");
  doc.text("Souhrn", margin, footY);
  doc.setFont("helvetica", "normal");
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
  doc.setFont("helvetica", "bold");
  doc.text(`Celkem zbývá (součet řádků): ${formatCurrency(totalRemaining)}`, margin, footY);

  const safeName = (options.fileName || `prehled-zakazek-${new Date().toISOString().slice(0, 10)}`)
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_");
  doc.save(`${safeName}.pdf`);
}
