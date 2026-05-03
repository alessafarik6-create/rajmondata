import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";

/** pdf.js viewport (scale 1) ≈ PDF body v „bodech“; převod na mm jako u 72 dpi tisku. */
const PDF_CSS_PX_TO_MM = 25.4 / 72;

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

/** „overview“ = rychlejší JPEG; „print“ = PNG + vyšší pdf.js násobič (ostřejší tisk A4). */
export type ProductionWorksheetExportVariant = "overview" | "print";

export type BuildProductionWorksheetPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawingNote?: string;
  rows: ProductionWorksheetConsumptionRow[];
  pendingLines?: string[];
  attachDrawing?: boolean;
  drawing?: ProductionWorksheetDrawingRef | null;
  fontBasePath?: string;
  variant?: ProductionWorksheetExportVariant;
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
   * Násobič kvality nad „vejde do rámečku“ (pdf.js viewport scale).
   * Minimum 3; u tiskové varianty výrobního listu se používá 4.
   */
  resolutionScale?: number;
  imageFormat?: "png" | "jpeg";
  jpegQuality?: number;
};

const RENDER_MAX_CANVAS_EDGE_PX = 12000;

function viewportCssPxToMm(vp: { width: number; height: number }): { wMm: number; hMm: number } {
  return {
    wMm: Math.max(0.01, vp.width * PDF_CSS_PX_TO_MM),
    hMm: Math.max(0.01, vp.height * PDF_CSS_PX_TO_MM),
  };
}

/**
 * Vykreslí jednu stránku PDF.js do canvasu ve zvýšeném rozlišení a vloží do PDF jako PNG/JPEG.
 * Správně převádí mm rámeček ↔ rozměry viewportu (dříve se mm dělily přímo „px“ viewportu → rozmazaný tisk).
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
    resolutionScale: resolutionScaleIn = 3,
    imageFormat = "png",
    jpegQuality = 0.95,
  } = params;

  const vp1 = pdfPage.getViewport({ scale: 1 });
  const { wMm, hMm } = viewportCssPxToMm(vp1);
  if (wMm < 0.5 || hMm < 0.5) return;

  const qualityMul = Math.max(Number(resolutionScaleIn) || 3, 3);
  const fit = Math.min(maxW / wMm, maxH / hMm);
  let renderScale = fit * qualityMul;

  let vp = pdfPage.getViewport({ scale: renderScale });
  while (
    (vp.width > RENDER_MAX_CANVAS_EDGE_PX || vp.height > RENDER_MAX_CANVAS_EDGE_PX) &&
    renderScale > fit * 2.2
  ) {
    renderScale -= fit * 0.2;
    vp = pdfPage.getViewport({ scale: renderScale });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

  const dataUrl =
    imageFormat === "png"
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", jpegQuality);
  const fmt: "PNG" | "JPEG" = imageFormat === "png" ? "PNG" : "JPEG";

  const ar = wMm / hMm;
  const boxAr = maxW / maxH;
  let drawW = maxW;
  let drawH = maxH;
  if (ar > boxAr) {
    drawH = maxH;
    drawW = maxH * ar;
  } else {
    drawW = maxW;
    drawH = maxW / ar;
  }
  const px = x + (maxW - drawW) / 2;
  const py = y + (maxH - drawH) / 2;
  doc.addImage(dataUrl, fmt, px, py, drawW, drawH);
}

function addImageDataUrlLetterboxed(doc: jsPDF, dataUrl: string, fmt: "JPEG" | "PNG", marginMm: number) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - 2 * marginMm;
  const maxH = pageH - 2 * marginMm;
  const imgProps = doc.getImageProperties(dataUrl);
  const iw = imgProps.width;
  const ih = imgProps.height;
  if (iw < 1 || ih < 1) return;
  const wMm = iw * PDF_CSS_PX_TO_MM;
  const hMm = ih * PDF_CSS_PX_TO_MM;
  const ar = wMm / hMm;
  const boxAr = maxW / maxH;
  let drawW = maxW;
  let drawH = maxH;
  if (ar > boxAr) {
    drawH = maxH;
    drawW = maxH * ar;
  } else {
    drawW = maxW;
    drawH = maxW / ar;
  }
  const x = marginMm + (maxW - drawW) / 2;
  const y = marginMm + (maxH - drawH) / 2;
  doc.addImage(dataUrl, fmt, x, y, drawW, drawH);
}

/**
 * Ostrý obrázek výkresu (ne náhled z UI): přenačte URL, vykreslí na canvas ve zvýšeném rozlišení.
 */
async function appendRasterDrawingFullPage(
  doc: jsPDF,
  url: string,
  fileName: string,
  variant: ProductionWorksheetExportVariant
): Promise<void> {
  const u = String(url || "").trim();
  if (!u) return;
  try {
    const dataUrlIn = await fetchImageAsDataUrl(u);
    if (!dataUrlIn) throw new Error("fetch");
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const nw = Math.max(1, img.naturalWidth || img.width);
          const nh = Math.max(1, img.naturalHeight || img.height);
          const orient: "portrait" | "landscape" = nw >= nh ? "landscape" : "portrait";
          doc.addPage("a4", orient);
          const qualityMul = variant === "print" ? 4 : 3;
          const capW = Math.min(12000, Math.floor(nw * qualityMul));
          const capH = Math.floor((nh / nw) * capW);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, capW);
          canvas.height = Math.max(1, capH);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve();
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out =
            variant === "print" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.95);
          const fmt: "PNG" | "JPEG" = variant === "print" ? "PNG" : "JPEG";
          addImageDataUrlLetterboxed(doc, out, fmt, 4);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("image-load"));
      img.src = dataUrlIn;
    });
  } catch {
    doc.addPage("a4", "portrait");
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(
      `Výkres (obrázek) se nepodařilo vložit. Soubor: ${fileName}\nOdkaz: ${u}`,
      doc.internal.pageSize.getWidth() - 20
    );
    doc.text(lines, 14, 20);
  }
}

async function appendPdfDrawingPages(
  doc: jsPDF,
  drawing: ProductionWorksheetDrawingRef,
  variant: ProductionWorksheetExportVariant
): Promise<void> {
  const { url, fileName } = drawing;
  const u = String(url || "").trim();
  if (!u) return;

  const resScale = variant === "print" ? 4 : 3;
  const imageFormat = variant === "print" ? "png" : "jpeg";
  const jpegQ = 0.95;

  try {
    const pdf = await loadPdfDocumentFromUrl(u);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const orient: "portrait" | "landscape" = vp1.width >= vp1.height ? "landscape" : "portrait";
      doc.addPage("a4", orient);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 4;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;
      await renderPdfJsPageToJsPdfRegion(doc, page, {
        x: margin,
        y: margin,
        maxW,
        maxH,
        resolutionScale: resScale,
        imageFormat,
        jpegQuality: jpegQ,
      });
    }
    try {
      pdf.destroy?.();
    } catch {
      /* */
    }
  } catch {
    doc.addPage("a4", "portrait");
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(
      `Výkres (PDF) se nepodařilo vložit. Soubor: ${fileName}\nOdkaz: ${u}`,
      doc.internal.pageSize.getWidth() - 20
    );
    doc.text(lines, 14, 20);
  }
}

async function appendDrawingSection(
  doc: jsPDF,
  drawing: ProductionWorksheetDrawingRef,
  variant: ProductionWorksheetExportVariant
): Promise<void> {
  if (drawing.kind === "image") {
    await appendRasterDrawingFullPage(doc, drawing.url, drawing.fileName, variant);
    return;
  }
  await appendPdfDrawingPages(doc, drawing, variant);
}

function drawWorksheetCoverPage(doc: jsPDF, opts: BuildProductionWorksheetPdfOptions): void {
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
  y += 7;

  doc.setFontSize(9);
  doc.setTextColor(55, 55, 55);
  doc.text(
    opts.attachDrawing && opts.drawing
      ? "Výkres je na následujících stránkách (každá stránka PDF zvlášť, formát A4). Tabulka spotřeby materiálu je na samostatné stránce."
      : "Tabulka spotřeby materiálu je na následující stránce.",
    14,
    y,
    { maxWidth: pageW - 28 }
  );
  y += 12;
  doc.setTextColor(0, 0, 0);

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
    for (const ln of opts.pendingLines.slice(0, 40)) {
      doc.text(`• ${ln}`, 16, y);
      y += 4;
      if (y > 275) {
        doc.addPage("a4", "portrait");
        y = 14;
      }
    }
  }
}

function addMaterialTablePage(doc: jsPDF, opts: BuildProductionWorksheetPdfOptions): void {
  doc.addPage("a4", "portrait");
  const variant = opts.variant ?? "overview";
  const tableFont = variant === "print" ? 9 : 7;
  const headFont = variant === "print" ? 9 : 7;
  const pad = variant === "print" ? 1.6 : 1.2;

  let y = 12;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(12);
  doc.text("Spotřeba materiálu — řezy a kusy", 14, y);
  y += 8;

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
      fontSize: tableFont,
      cellPadding: pad,
      overflow: "linebreak",
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fontSize: headFont,
      fillColor: [41, 98, 120],
      textColor: [255, 255, 255],
    },
    bodyStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
    },
    margin: { left: 10, right: 10 },
  });
}

/**
 * Výrobní podklad — více stran A4: hlavička → výkres (pdf.js / ostrý rastr) → tabulka materiálu (text DejaVu).
 */
export async function buildProductionWorksheetPdf(opts: BuildProductionWorksheetPdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");

  drawWorksheetCoverPage(doc, opts);

  if (opts.attachDrawing && opts.drawing) {
    await appendDrawingSection(doc, opts.drawing, opts.variant ?? "overview");
  }

  addMaterialTablePage(doc, opts);

  return doc;
}

export function downloadProductionWorksheetPdf(
  doc: jsPDF,
  jobName: string,
  dateLabel: string,
  variant?: ProductionWorksheetExportVariant
): void {
  doc.save(buildProductionWorksheetFileName(jobName, dateLabel, variant));
}

export function getProductionWorksheetPdfBlob(doc: jsPDF): Blob {
  return doc.output("blob");
}

export function buildProductionWorksheetFileName(
  jobName: string,
  dateLabel: string,
  variant?: ProductionWorksheetExportVariant
): string {
  const safeJob = jobName.replace(/[^\w\-]+/g, "_").slice(0, 40);
  const safeDate = dateLabel.replace(/\./g, "-").replace(/[^\w\-]+/g, "_").slice(0, 40);
  const suffix = variant === "print" ? "-A4-tiskova-kvalita" : "";
  return `vyrobni-podklad-${safeJob}-${safeDate}${suffix}.pdf`;
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
