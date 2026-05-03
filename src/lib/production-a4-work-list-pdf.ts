import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";
import {
  loadPdfDocumentFromUrl,
  renderPdfJsPageToJsPdfRegion,
  type ProductionWorksheetDrawingRef,
} from "@/lib/production-worksheet-pdf";
import type { ProductionA4MaterialRow } from "@/lib/production-a4-material-rows";

export type { ProductionA4MaterialRow } from "@/lib/production-a4-material-rows";

export type BuildProductionA4WorkListPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawing: ProductionWorksheetDrawingRef | null;
  materialRows: ProductionA4MaterialRow[];
  footerNote?: string;
  fontBasePath?: string;
};

function drawHeaderBlock(doc: jsPDF, margin: number, opts: BuildProductionA4WorkListPdfOptions): number {
  let y = margin;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(14);
  doc.text("Výrobní list — výdej", margin, y);
  y += 7;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.text(`Zakázka: ${opts.jobName}`, margin, y);
  y += 4.5;
  doc.text(`Zákazník: ${opts.customerLabel || "—"}`, margin, y);
  y += 4.5;
  doc.text(`Datum: ${opts.dateLabel}`, margin, y);
  y += 7;
  return y;
}

/**
 * A4 výrobní list: hlavička, všechny stránky PDF výkresu (pdf.js → canvas, celé stránky),
 * poté tabulka materiálu (autoTable, vlastní stránkování).
 */
export async function buildProductionA4WorkListPdf(opts: BuildProductionA4WorkListPdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");

  const margin = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxBoxW = pageW - 2 * margin;
  const maxBoxH = pageH - 2 * margin;

  const afterHeaderY = drawHeaderBlock(doc, margin, opts);

  const drawing = opts.drawing;
  const u = drawing ? String(drawing.url || "").trim() : "";

  /** Po výkresech vždy nová stránka pro tabulku; bez výkresu tabulka pod hlavičkou. */
  let tableOnFreshPage = false;

  if (drawing && u) {
    if (drawing.kind === "pdf") {
      tableOnFreshPage = true;
      let pdf: import("pdfjs-dist").PDFDocumentProxy | null = null;
      try {
        pdf = await loadPdfDocumentFromUrl(u);
        const n = pdf.numPages;
        for (let i = 1; i <= n; i++) {
          const page = await pdf.getPage(i);
          if (i === 1) {
            const hBelowHeader = pageH - afterHeaderY - margin;
            if (hBelowHeader >= 85) {
              await renderPdfJsPageToJsPdfRegion(doc, page, {
                x: margin,
                y: afterHeaderY,
                maxW: maxBoxW,
                maxH: hBelowHeader,
              });
            } else {
              doc.addPage();
              await renderPdfJsPageToJsPdfRegion(doc, page, { x: margin, y: margin, maxW: maxBoxW, maxH: maxBoxH });
            }
          } else {
            doc.addPage();
            await renderPdfJsPageToJsPdfRegion(doc, page, { x: margin, y: margin, maxW: maxBoxW, maxH: maxBoxH });
          }
        }
      } finally {
        try {
          pdf?.destroy?.();
        } catch {
          /* */
        }
      }
    } else if (drawing.kind === "image") {
      tableOnFreshPage = true;
      try {
        const dataUrl = await fetchImageAsDataUrl(u);
        if (dataUrl) {
          const fmt: "JPEG" | "PNG" = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
          const props = doc.getImageProperties(dataUrl);
          const iw = props.width;
          const ih = props.height;
          if (iw > 1 && ih > 1) {
            const hBelowHeader = pageH - afterHeaderY - margin;
            let maxW = maxBoxW;
            let maxH = maxBoxH;
            let x0 = margin;
            let y0 = margin;
            if (hBelowHeader >= 70) {
              maxH = hBelowHeader;
              y0 = afterHeaderY;
            } else {
              doc.addPage();
            }
            let w = maxW;
            let h = (ih * w) / iw;
            if (h > maxH) {
              h = maxH;
              w = (iw * h) / ih;
            }
            const px = x0 + (maxW - w) / 2;
            const py = y0 + (maxH - h) / 2;
            doc.addImage(dataUrl, fmt, px, py, w, h);
          }
        } else {
          doc.setFont(PDF_FONT_FAMILY, "normal");
          doc.setFontSize(10);
          doc.text(`Obrázek výkresu se nepodařilo načíst: ${drawing.fileName}`, margin, afterHeaderY + 4);
        }
      } catch {
        doc.setFont(PDF_FONT_FAMILY, "normal");
        doc.setFontSize(10);
        doc.text(`Obrázek výkresu se nepodařilo načíst: ${drawing.fileName}`, margin, afterHeaderY + 4);
      }
    }
  }

  const body = opts.materialRows.map((r) => r.cells);

  const head = [
    [
      "Položka",
      "Odebráno (součet)",
      "j.",
      "Délka kusu",
      "Řez / použito",
      "Zbytek z kusu",
      "Kusů po řezu",
      "Celk. zbytek (řádek)",
      "Pozn.",
      "Stav výkresu",
    ],
  ];

  if (tableOnFreshPage) {
    doc.addPage();
  }

  const startY = tableOnFreshPage ? margin : afterHeaderY + 2;

  autoTable(doc, {
    startY,
    margin: { left: margin, right: margin },
    head,
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: 7,
      cellPadding: 1.1,
      overflow: "linebreak",
    },
    headStyles: { font: PDF_FONT_FAMILY, fontStyle: "bold", fillColor: [41, 98, 120], textColor: 255 },
    bodyStyles: { font: PDF_FONT_FAMILY },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = opts.materialRows[data.row.index];
      if (!row) return;
      if (row.boldRemainder && data.column.index === 5) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = [15, 118, 110];
      }
      if (row.boldLineTotal && data.column.index === 7) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = [15, 118, 110];
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? startY + 40;
  let footY = Math.min(finalY + 6, pageH - margin - 14);
  if (opts.footerNote) {
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(opts.footerNote, pageW - 2 * margin);
    doc.text(lines, margin, footY);
    footY += lines.length * 3.6 + 4;
  }
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8);
  doc.text("Kontrola / podpis: ________________________________", margin, Math.min(footY, pageH - margin));

  return doc;
}

export function downloadProductionA4WorkListPdf(doc: jsPDF, jobName: string, dateLabel: string): void {
  const safe = jobName.replace(/[^\w\-]+/g, "_").slice(0, 36);
  const fn = `vyrobni-list-A4-${safe}-${dateLabel.replace(/\./g, "-").replace(/[:\s]/g, "_")}.pdf`;
  doc.save(fn);
}

export function openProductionA4WorkListPdfPrint(doc: jsPDF): void {
  const blob = doc.output("blob");
  const u = URL.createObjectURL(blob);
  const w = window.open(u, "_blank", "noopener,noreferrer");
  if (w) {
    w.onload = () => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* */
      }
    };
  }
}
