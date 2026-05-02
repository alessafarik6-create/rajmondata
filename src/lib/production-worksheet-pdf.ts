import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type ProductionWorksheetConsumptionRow = {
  itemName: string;
  quantity: string;
  unit: string;
  repeatCount?: string;
  note?: string;
  remainingOnStock?: string;
  stockPieceSummary?: string;
  allocations?: string;
  createdBy?: string;
  createdAt?: string;
  bulkGroup?: string;
};

/**
 * Výrobní podklad pro tisk — zakázka, zákazník, datum, tabulka spotřeb.
 */
export function buildProductionWorksheetPdf(opts: {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawingNote?: string;
  rows: ProductionWorksheetConsumptionRow[];
  pendingLines?: string[];
}): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Výrobní podklad", 14, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Zakázka: ${opts.jobName}`, 14, y);
  y += 5;
  doc.text(`Zákazník: ${opts.customerLabel || "—"}`, 14, y);
  y += 5;
  doc.text(`Datum: ${opts.dateLabel}`, 14, y);
  y += 6;

  if (opts.drawingNote) {
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(opts.drawingNote, pageW - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 4;
    doc.setTextColor(0, 0, 0);
  }

  if (opts.pendingLines && opts.pendingLines.length > 0) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Připraveno k výdeji (ještě neodebráno)", 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    for (const ln of opts.pendingLines.slice(0, 30)) {
      doc.text(`• ${ln}`, 16, y);
      y += 4;
      if (y > 270) {
        doc.addPage();
        y = 14;
      }
    }
    y += 4;
  }

  const tableBody = opts.rows.map((r) => [
    r.itemName,
    r.quantity,
    r.unit,
    r.repeatCount ?? "—",
    r.remainingOnStock ?? "—",
    r.allocations ?? "—",
    r.note ?? "",
    r.createdBy ?? "—",
    r.createdAt ?? "—",
  ]);

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Položka",
        "Množ.",
        "j.",
        "Řezy",
        "Zbývá sklad",
        "Odebráno z kusů",
        "Pozn.",
        "Kdo",
        "Kdy",
      ],
    ],
    body: tableBody,
    styles: { fontSize: 7, cellPadding: 1.2 },
    headStyles: { fillColor: [41, 98, 120] },
    margin: { left: 10, right: 10 },
  });

  const fn = `vyrobni-podklad-${opts.jobName.replace(/[^\w\-]+/g, "_").slice(0, 40)}-${opts.dateLabel.replace(/\./g, "-")}.pdf`;
  doc.save(fn);
}
