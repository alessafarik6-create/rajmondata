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

/** „Přehled“ = menší násobič / JPEG; „Tisk“ = vyšší rozlišení, PNG výkresu, větší tabulka. */
export type ProductionA4ExportVariant = "overview" | "print";

export type BuildProductionA4WorkListPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawing: ProductionWorksheetDrawingRef | null;
  materialRows: ProductionA4MaterialRow[];
  footerNote?: string;
  fontBasePath?: string;
  variant?: ProductionA4ExportVariant;
};

const DRAW_MARGIN_MM = 6;

function drawHeaderPortrait(doc: jsPDF, margin: number, opts: BuildProductionA4WorkListPdfOptions): number {
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

/** Kompaktní hlavička na první landscape stránce (nad výkresem). */
function drawHeaderLandscape(
  doc: jsPDF,
  margin: number,
  opts: BuildProductionA4WorkListPdfOptions,
  textMaxW: number
): number {
  let y = margin + 3;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  doc.text("Výrobní list — výdej", margin, y);
  y += 5;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8.5);
  const one = `${opts.jobName} · ${opts.customerLabel || "—"} · ${opts.dateLabel}`;
  const lines = doc.splitTextToSize(one, textMaxW);
  doc.text(lines, margin, y);
  y += lines.length * 3.8 + 4;
  return y;
}

function variantRenderOpts(variant: ProductionA4ExportVariant): {
  resolutionScale: number;
  imageFormat: "png" | "jpeg";
  jpegQuality: number;
  tableFont: number;
  tableHeadFont: number;
  cellPadding: number;
} {
  if (variant === "print") {
    return {
      resolutionScale: 3,
      imageFormat: "png",
      jpegQuality: 0.95,
      tableFont: 10,
      tableHeadFont: 10,
      cellPadding: 2,
    };
  }
  return {
    resolutionScale: 2.5,
    imageFormat: "jpeg",
    jpegQuality: 0.95,
    tableFont: 9,
    tableHeadFont: 9,
    cellPadding: 1.4,
  };
}

/**
 * Vloží rastr výkresu přes canvas ve zvýšeném rozlišení (ne nízký náhled).
 */
async function embedRasterImageHighRes(
  doc: jsPDF,
  url: string,
  region: { x: number; y: number; maxW: number; maxH: number },
  variant: ProductionA4ExportVariant
): Promise<void> {
  const dataUrl = await fetchImageAsDataUrl(url);
  if (!dataUrl) return;

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const nw = Math.max(1, img.naturalWidth || img.width);
        const nh = Math.max(1, img.naturalHeight || img.height);
        const scaleMul = variant === "print" ? 3 : 2.5;
        const targetW = Math.min(10000, Math.floor(nw * scaleMul));
        const targetH = Math.floor((nh / nw) * targetW);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, targetW);
        canvas.height = Math.max(1, targetH);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve();
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out =
          variant === "print"
            ? canvas.toDataURL("image/png")
            : canvas.toDataURL("image/jpeg", 0.95);
        const fmt: "PNG" | "JPEG" = variant === "print" ? "PNG" : "JPEG";
        const { x, y, maxW, maxH } = region;
        const imgProps = doc.getImageProperties(out);
        const iw = imgProps.width;
        const ih = imgProps.height;
        if (iw < 1 || ih < 1) {
          resolve();
          return;
        }
        let w = maxW;
        let h = (ih * w) / iw;
        if (h > maxH) {
          h = maxH;
          w = (iw * h) / ih;
        }
        const px = x + (maxW - w) / 2;
        const py = y + (maxH - h) / 2;
        doc.addImage(out, fmt, px, py, w, h);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("image-load"));
    img.src = dataUrl;
  });
}

function addMaterialTable(
  doc: jsPDF,
  opts: BuildProductionA4WorkListPdfOptions,
  margin: number,
  startY: number,
  ro: ReturnType<typeof variantRenderOpts>
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
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

  autoTable(doc, {
    startY,
    margin: { left: margin, right: margin },
    head,
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: ro.tableFont,
      cellPadding: ro.cellPadding,
      overflow: "linebreak",
      minCellHeight: ro.tableFont + ro.cellPadding * 2,
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fontSize: ro.tableHeadFont,
      fillColor: [41, 98, 120],
      textColor: 255,
    },
    bodyStyles: { font: PDF_FONT_FAMILY, fontSize: ro.tableFont },
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
}

/**
 * Výrobní list: výkres(y) na **A4 landscape** (ostrý render pdf.js), tabulka materiálu na **A4 portrait**
 * jako skutečný text (DejaVu), větší písmo u varianty tisk.
 */
export async function buildProductionA4WorkListPdf(opts: BuildProductionA4WorkListPdfOptions): Promise<jsPDF> {
  const variant: ProductionA4ExportVariant = opts.variant ?? "overview";
  const ro = variantRenderOpts(variant);

  const drawing = opts.drawing;
  const u = drawing ? String(drawing.url || "").trim() : "";

  if (!drawing || !u) {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");
    const margin = 10;
    const afterY = drawHeaderPortrait(doc, margin, opts);
    addMaterialTable(doc, opts, margin, afterY + 2, ro);
    return doc;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");

  let lw = doc.internal.pageSize.getWidth();
  let lh = doc.internal.pageSize.getHeight();

  if (drawing.kind === "pdf") {
    let pdf: import("pdfjs-dist").PDFDocumentProxy | null = null;
    try {
      pdf = await loadPdfDocumentFromUrl(u);
      const n = pdf.numPages;
      for (let i = 1; i <= n; i++) {
        lw = doc.internal.pageSize.getWidth();
        lh = doc.internal.pageSize.getHeight();
        const page = await pdf.getPage(i);
        if (i === 1) {
          const headerEnd = drawHeaderLandscape(doc, DRAW_MARGIN_MM, opts, lw - 2 * DRAW_MARGIN_MM);
          const maxW = lw - 2 * DRAW_MARGIN_MM;
          const maxH = lh - headerEnd - DRAW_MARGIN_MM;
          await renderPdfJsPageToJsPdfRegion(doc, page, {
            x: DRAW_MARGIN_MM,
            y: headerEnd,
            maxW,
            maxH,
            resolutionScale: ro.resolutionScale,
            imageFormat: ro.imageFormat,
            jpegQuality: ro.jpegQuality,
          });
        } else {
          doc.addPage("a4", "landscape");
          lw = doc.internal.pageSize.getWidth();
          lh = doc.internal.pageSize.getHeight();
          const maxW = lw - 2 * DRAW_MARGIN_MM;
          const maxH = lh - 2 * DRAW_MARGIN_MM;
          await renderPdfJsPageToJsPdfRegion(doc, page, {
            x: DRAW_MARGIN_MM,
            y: DRAW_MARGIN_MM,
            maxW,
            maxH,
            resolutionScale: ro.resolutionScale,
            imageFormat: ro.imageFormat,
            jpegQuality: ro.jpegQuality,
          });
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
    const headerEnd = drawHeaderLandscape(doc, DRAW_MARGIN_MM, opts, lw - 2 * DRAW_MARGIN_MM);
    const maxW = lw - 2 * DRAW_MARGIN_MM;
    const maxH = lh - headerEnd - DRAW_MARGIN_MM;
    try {
      await embedRasterImageHighRes(doc, u, { x: DRAW_MARGIN_MM, y: headerEnd, maxW, maxH }, variant);
    } catch {
      doc.setFont(PDF_FONT_FAMILY, "normal");
      doc.setFontSize(10);
      doc.text(`Obrázek výkresu se nepodařilo načíst: ${drawing.fileName}`, DRAW_MARGIN_MM, headerEnd + 4);
    }
  }

  doc.addPage("a4", "portrait");
  const margin = 10;
  const titleY = margin + 2;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  doc.text("Materiál — řezy a zbytky", margin, titleY);
  addMaterialTable(doc, opts, margin, titleY + 6, ro);

  return doc;
}

export function downloadProductionA4WorkListPdf(
  doc: jsPDF,
  jobName: string,
  dateLabel: string,
  variant: ProductionA4ExportVariant = "overview"
): void {
  const safe = jobName.replace(/[^\w\-]+/g, "_").slice(0, 32);
  const part = variant === "print" ? "tisk" : "prehled";
  const fn = `vyrobni-list-A4-${part}-${safe}-${dateLabel.replace(/\./g, "-").replace(/[:\s]/g, "_")}.pdf`;
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
