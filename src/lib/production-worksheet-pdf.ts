import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";

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

export type ProductionWorksheetDrawingRef = {
  url: string;
  fileName: string;
  kind: "pdf" | "image";
};

export type BuildProductionWorksheetPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawingNote?: string;
  rows: ProductionWorksheetConsumptionRow[];
  pendingLines?: string[];
  /** Přiložit aktuální výkres (PDF jako náhled stránek, obrázek jako obrázek). */
  attachDrawing?: boolean;
  drawing?: ProductionWorksheetDrawingRef | null;
  /** Kořen pro /fonts/DejaVu*.ttf */
  fontBasePath?: string;
};

async function loadPdfJsWorker() {
  const pdfjs = await import("pdfjs-dist");
  const { configurePdfJsWorker } = await import("@/lib/pdfjs-worker");
  configurePdfJsWorker(pdfjs);
  return pdfjs;
}

/** Načte PDF dokument z URL (CORS / fetch fallback jako u výkresu). */
export async function loadPdfDocumentFromUrl(url: string): Promise<import("pdfjs-dist").PDFDocumentProxy> {
  const pdfjs = await loadPdfJsWorker();
  const u = String(url || "").trim();
  if (!u) throw new Error("Prázdná URL PDF");
  try {
    const task = pdfjs.getDocument({
      url: u,
      withCredentials: false,
      disableRange: true,
      disableStream: true,
    });
    return await task.promise;
  } catch {
    const res = await fetch(u, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(String(res.status));
    const buf = await res.arrayBuffer();
    const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableRange: true, disableStream: true });
    return await task.promise;
  }
}

/** Parametry vykreslení jedné stránky PDF.js do jsPDF (mm). */
export type RenderPdfPageToJsPdfRegionParams = {
  x: number;
  y: number;
  maxW: number;
  maxH: number;
  /**
   * Násobič rozlišení canvasu oproti minimálnímu „vejde do boxu“.
   * Min. 2.5 pro čitelný text na tisku; 3 u varianty vysoká kvalita.
   */
  resolutionScale?: number;
  imageFormat?: "png" | "jpeg";
  /** Použije se jen při imageFormat jpeg (0.92–0.98). */
  jpegQuality?: number;
};

const RENDER_MAX_CANVAS_EDGE_PX = 9000;

/**
 * Vykreslí jednu stránku PDF.js do canvasu ve zvýšeném rozlišení a vloží do PDF jako PNG/JPEG.
 * Výstupní rozměr v mm zůstává maxW×maxH (ostřejší bitmapa při stejném layoutu).
 */
export async function renderPdfJsPageToJsPdfRegion(
  doc: jsPDF,
  pdfPage: import("pdfjs-dist").PDFPageProxy,
  params: RenderPdfPageToJsPdfRegionParams
): Promise<void> {
  const {
    x,
    y,
    maxW,
    maxH,
    resolutionScale: resolutionScaleIn = 2.5,
    imageFormat = "jpeg",
    jpegQuality = 0.95,
  } = params;

  const base = pdfPage.getViewport({ scale: 1 });
  if (base.width < 1 || base.height < 1) return;

  const fitScale = Math.min(maxW / base.width, maxH / base.height);
  let resMul = Math.max(resolutionScaleIn, 2.5);
  let vp = pdfPage.getViewport({ scale: fitScale * resMul });
  while ((vp.width > RENDER_MAX_CANVAS_EDGE_PX || vp.height > RENDER_MAX_CANVAS_EDGE_PX) && resMul > 2.5) {
    resMul -= 0.2;
    vp = pdfPage.getViewport({ scale: fitScale * resMul });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

  const dataUrl =
    imageFormat === "png"
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", jpegQuality);
  const fmt: "PNG" | "JPEG" = imageFormat === "png" ? "PNG" : "JPEG";

  const imgProps = doc.getImageProperties(dataUrl);
  const iw = imgProps.width;
  const ih = imgProps.height;
  if (iw < 1 || ih < 1) return;
  let w = maxW;
  let h = (ih * w) / iw;
  if (h > maxH) {
    h = maxH;
    w = (iw * h) / ih;
  }
  const px = x + (maxW - w) / 2;
  const py = y + (maxH - h) / 2;
  doc.addImage(dataUrl, fmt, px, py, w, h);
}

function addImageDataUrlToPage(doc: jsPDF, dataUrl: string, fmt: "JPEG" | "PNG") {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin;
  const imgProps = doc.getImageProperties(dataUrl);
  const iw = imgProps.width;
  const ih = imgProps.height;
  if (iw < 1 || ih < 1) return;
  let w = maxW;
  let h = (ih * w) / iw;
  if (h > maxH) {
    h = maxH;
    w = (iw * h) / ih;
  }
  const x = margin + (maxW - w) / 2;
  const y = margin + (maxH - h) / 2;
  doc.addImage(dataUrl, fmt, x, y, w, h);
}

async function appendDrawingToDoc(doc: jsPDF, drawing: ProductionWorksheetDrawingRef): Promise<void> {
  const { url, fileName, kind } = drawing;
  const u = String(url || "").trim();
  if (!u) return;

  if (kind === "image") {
    try {
      const dataUrl = await fetchImageAsDataUrl(u);
      if (!dataUrl) throw new Error("fetch");
      const fmt: "JPEG" | "PNG" = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addPage();
      addImageDataUrlToPage(doc, dataUrl, fmt);
    } catch {
      doc.addPage();
      doc.setFont(PDF_FONT_FAMILY, "normal");
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(
        `Výkres (obrázek) se nepodařilo vložit. Soubor: ${fileName}\nOdkaz: ${u}`,
        doc.internal.pageSize.getWidth() - 20
      );
      doc.text(lines, 14, 20);
    }
    return;
  }

  try {
    const pdf = await loadPdfDocumentFromUrl(u);

    for (let i = 1; i <= pdf.numPages; i++) {
      doc.addPage();
      const page = await pdf.getPage(i);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 8;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;
      await renderPdfJsPageToJsPdfRegion(doc, page, {
        x: margin,
        y: margin,
        maxW,
        maxH,
        resolutionScale: 2.5,
        imageFormat: "jpeg",
        jpegQuality: 0.95,
      });
    }
    try {
      pdf.destroy?.();
    } catch {
      /* */
    }
  } catch {
    doc.addPage();
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(
      `Výkres (PDF) se nepodařilo vložit jako náhled. Soubor: ${fileName}\nOdkaz: ${u}`,
      doc.internal.pageSize.getWidth() - 20
    );
    doc.text(lines, 14, 20);
  }
}

/**
 * Výrobní podklad pro tisk — zakázka, zákazník, datum, tabulka spotřeb.
 * Font DejaVu Sans (UTF-8 / čeština).
 */
export async function buildProductionWorksheetPdf(opts: BuildProductionWorksheetPdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");

  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(16);
  doc.text("Výrobní podklad", 14, y);
  y += 8;

  doc.setFont(PDF_FONT_FAMILY, "normal");
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
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.text("Připraveno k výdeji (ještě neodebráno)", 14, y);
    y += 5;
    doc.setFont(PDF_FONT_FAMILY, "normal");
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
    styles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
      fontSize: 7,
      cellPadding: 1.2,
      overflow: "linebreak",
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: [41, 98, 120],
      textColor: [255, 255, 255],
    },
    bodyStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
    },
    margin: { left: 10, right: 10 },
  });

  if (opts.attachDrawing && opts.drawing) {
    await appendDrawingToDoc(doc, opts.drawing);
  }

  return doc;
}

export function downloadProductionWorksheetPdf(doc: jsPDF, jobName: string, dateLabel: string): void {
  const fn = `vyrobni-podklad-${jobName.replace(/[^\w\-]+/g, "_").slice(0, 40)}-${dateLabel.replace(/\./g, "-")}.pdf`;
  doc.save(fn);
}

export function openProductionWorksheetPdfInNewTab(doc: jsPDF): void {
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
