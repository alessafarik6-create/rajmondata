import { jsPDF } from "jspdf";
import {
  scaleCanvasMaxSide,
  type AnnotatedCompositeResult,
} from "@/lib/job-photo-annotation-export-composite";
import {
  drawLegendPanel,
  estimateLegendPanelHeight,
  formatLegendEntryLineForExport,
} from "@/lib/job-photo-shape-label";
import type { AnnotationLegendEntry } from "@/lib/job-photo-annotations";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";

const PDF_CANVAS_MAX_SIDE = 7200;
const MARGIN_MM = 8;
const SIDEBAR_MM = 36;
const GAP_MM = 3;

function safePdfFileName(base: string): string {
  const t = (base || "vykres")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return t || "vykres";
}

function isCompositeResult(
  input: HTMLCanvasElement | AnnotatedCompositeResult
): input is AnnotatedCompositeResult {
  return typeof input === "object" && input !== null && "drawingCanvas" in input;
}

function resolveExportParts(input: HTMLCanvasElement | AnnotatedCompositeResult): {
  drawing: HTMLCanvasElement;
  legendEntries: AnnotationLegendEntry[];
  legendLayout: AnnotatedCompositeResult["legendLayout"] | "none";
} {
  if (isCompositeResult(input)) {
    return {
      drawing: input.drawingCanvas,
      legendEntries: input.legendEntries,
      legendLayout: input.legendLayout,
    };
  }
  return { drawing: input, legendEntries: [], legendLayout: "none" };
}

function fitImageInBoxMm(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number
): { dw: number; dh: number } {
  const pxToMm = 25.4 / 96;
  const imgWmm = imgW * pxToMm;
  const imgHmm = imgH * pxToMm;
  let dw = Math.min(boxW, imgWmm);
  let dh = (imgH / imgW) * dw;
  if (dh > boxH) {
    dh = boxH;
    dw = (imgW / imgH) * dh;
  }
  return { dw, dh };
}

function renderLegendSidebarCanvas(
  entries: AnnotationLegendEntry[],
  heightPx: number,
  widthPx: number
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, widthPx);
  c.height = Math.max(1, heightPx);
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    drawLegendPanel(ctx, entries, 0, 0, c.width, c.height, "export-light");
  }
  return c;
}

function legendFitsSidebarOnA4(
  entries: AnnotationLegendEntry[],
  pageInnerHmm: number,
  sidebarWidthPx: number
): boolean {
  if (!entries.length) return false;
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  if (!ctx) return false;
  const h = estimateLegendPanelHeight(ctx, entries, sidebarWidthPx, "export-light");
  const pxToMm = 25.4 / 96;
  return h * pxToMm <= pageInnerHmm - 4;
}

async function addLegendTextPages(
  doc: jsPDF,
  entries: AnnotationLegendEntry[]
): Promise<void> {
  await registerDejaVuFontsForPdf(doc, "/fonts");
  const margin = MARGIN_MM;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - 2 * margin;
  let y = margin + 4;

  const ensureSpace = (needMm: number) => {
    if (y + needMm > pageH - margin) {
      doc.addPage();
      y = margin + 4;
    }
  };

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  ensureSpace(8);
  doc.text("Legenda", margin, y);
  y += 6;

  const shapes = entries.filter((e) => !e.arrowNote);
  const arrows = entries.filter((e) => e.arrowNote);

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);

  for (const e of shapes) {
    const lines = doc.splitTextToSize(formatLegendEntryLineForExport(e), maxW) as string[];
    for (const ln of lines) {
      ensureSpace(5);
      doc.text(ln, margin, y);
      y += 4.2;
    }
    y += 1;
  }

  if (arrows.length) {
    y += 2;
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(9);
    ensureSpace(6);
    doc.text("Poznámky / Šipky", margin, y);
    y += 5;
    doc.setFont(PDF_FONT_FAMILY, "normal");
    for (const e of arrows) {
      const lines = doc.splitTextToSize(formatLegendEntryLineForExport(e), maxW) as string[];
      for (const ln of lines) {
        ensureSpace(5);
        doc.text(ln, margin, y);
        y += 4.2;
      }
      y += 1;
    }
  }
}

/**
 * Vloží výkres (a případně krátkou legendu) do existujícího nebo nového PDF.
 */
export async function layoutAnnotatedDrawingOnPdf(
  doc: jsPDF,
  input: HTMLCanvasElement | AnnotatedCompositeResult
): Promise<void> {
  const { drawing, legendEntries, legendLayout } = resolveExportParts(input);
  const scaledDrawing = scaleCanvasMaxSide(drawing, PDF_CANVAS_MAX_SIDE);

  const pageW = doc.internal.pageSize.getWidth() - 2 * MARGIN_MM;
  const pageH = doc.internal.pageSize.getHeight() - 2 * MARGIN_MM;
  const drawLandscape = scaledDrawing.width >= scaledDrawing.height;

  const sidebarWidthPx = 150;
  const useSidebar =
    drawLandscape &&
    legendEntries.length > 0 &&
    (legendLayout === "sidebar" ||
      legendFitsSidebarOnA4(legendEntries, pageH, sidebarWidthPx));

  const drawingDataUrl = scaledDrawing.toDataURL("image/png");

  if (useSidebar) {
    const drawBoxW = pageW - SIDEBAR_MM - GAP_MM;
    const { dw, dh } = fitImageInBoxMm(
      scaledDrawing.width,
      scaledDrawing.height,
      drawBoxW,
      pageH
    );
    const dx = MARGIN_MM + (drawBoxW - dw) / 2;
    const dy = MARGIN_MM + (pageH - dh) / 2;
    doc.addImage(drawingDataUrl, "PNG", dx, dy, dw, dh);

    const legendCanvas = renderLegendSidebarCanvas(
      legendEntries,
      scaledDrawing.height,
      sidebarWidthPx
    );
    const legendScaled = scaleCanvasMaxSide(legendCanvas, 2400);
    const legPxToMm = 25.4 / 96;
    const legWmm = Math.min(SIDEBAR_MM, legendScaled.width * legPxToMm);
    const legHmm = Math.min(pageH, legendScaled.height * legPxToMm);
    const lx = MARGIN_MM + pageW - legWmm;
    const ly = MARGIN_MM + (pageH - legHmm) / 2;
    doc.addImage(
      legendScaled.toDataURL("image/png"),
      "PNG",
      lx,
      ly,
      legWmm,
      legHmm
    );
  } else {
    const { dw, dh } = fitImageInBoxMm(
      scaledDrawing.width,
      scaledDrawing.height,
      pageW,
      pageH
    );
    const x = MARGIN_MM + (pageW - dw) / 2;
    const y = MARGIN_MM + (pageH - dh) / 2;
    doc.addImage(drawingDataUrl, "PNG", x, y, dw, dh);

    if (legendEntries.length > 0 && !useSidebar) {
      await addLegendTextPages(doc, legendEntries);
    }
  }
}

/**
 * A4 PDF: výkres maximalizovaný; krátká legenda vpravo (landscape) nebo na další stránce.
 */
export async function downloadAnnotatedCompositeAsPdf(
  input: HTMLCanvasElement | AnnotatedCompositeResult,
  filenameBase: string
): Promise<void> {
  const { drawing } = resolveExportParts(input);
  const drawLandscape = drawing.width >= drawing.height;
  const doc = new jsPDF({
    orientation: drawLandscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  await layoutAnnotatedDrawingOnPdf(doc, input);
  doc.save(`${safePdfFileName(filenameBase)}-anotace.pdf`);
}

export const ANNOTATED_PRINT_PAGE_CSS = `
  html,body{margin:0;padding:0;background:#fff;color:#111;}
  .sheet{box-sizing:border-box;padding:10mm;}
  .layout-side{display:flex;flex-direction:row;align-items:flex-start;gap:3mm;}
  .layout-side .drawing{flex:1 1 auto;min-width:0;}
  .layout-side .legend-side{flex:0 0 38mm;max-width:38mm;}
  .layout-side .legend-side img{width:100%;height:auto;display:block;}
  .layout-stack .drawing img{width:100%;height:auto;display:block;}
  .legend-page{page-break-before:always;padding:10mm;font:10px/1.35 system-ui,sans-serif;}
  .legend-page h2{font-size:12px;margin:0 0 6px;}
  .legend-page .sub{font-size:9px;font-weight:600;color:#64748b;margin:8px 0 4px;}
  .legend-page p{margin:0 0 4px;word-wrap:break-word;overflow-wrap:anywhere;}
`;

export function buildAnnotatedPrintDocumentBody(
  input: HTMLCanvasElement | AnnotatedCompositeResult
): { bodyInner: string; layoutClass: string; pageSizeCss: string } {
  const { drawing, legendEntries, legendLayout } = resolveExportParts(input);
  const scaledDrawing = scaleCanvasMaxSide(drawing, PDF_CANVAS_MAX_SIDE);
  const drawLandscape = scaledDrawing.width >= scaledDrawing.height;
  const drawingUrl = scaledDrawing.toDataURL("image/png");

  const sidebarWidthPx = 150;
  const pageInnerHmm = drawLandscape ? 190 : 277;
  const useSidebar =
    drawLandscape &&
    legendEntries.length > 0 &&
    (legendLayout === "sidebar" ||
      legendFitsSidebarOnA4(legendEntries, pageInnerHmm, sidebarWidthPx));

  let legendHtml = "";
  if (legendEntries.length > 0) {
    if (useSidebar) {
      const legendCanvas = renderLegendSidebarCanvas(
        legendEntries,
        scaledDrawing.height,
        sidebarWidthPx
      );
      const legendUrl = scaleCanvasMaxSide(legendCanvas, 2400).toDataURL("image/png");
      legendHtml = `<aside class="legend-side"><img src="${legendUrl}" alt="Legenda" /></aside>`;
    } else {
      const lines: string[] = [];
      lines.push('<div class="legend-page"><h2>Legenda</h2>');
      for (const e of legendEntries.filter((x) => !x.arrowNote)) {
        lines.push(`<p>${escapeHtml(formatLegendEntryLineForExport(e))}</p>`);
      }
      const arrows = legendEntries.filter((x) => x.arrowNote);
      if (arrows.length) {
        lines.push('<p class="sub">Poznámky / Šipky</p>');
        for (const e of arrows) {
          lines.push(`<p>${escapeHtml(formatLegendEntryLineForExport(e))}</p>`);
        }
      }
      lines.push("</div>");
      legendHtml = lines.join("");
    }
  }

  const layoutClass = useSidebar ? "layout-side" : "layout-stack";
  const bodyInner = `<div class="sheet ${layoutClass}">
  <div class="drawing"><img src="${drawingUrl}" alt="Výkres" /></div>
  ${legendHtml}
</div>`;

  return {
    bodyInner,
    layoutClass,
    pageSizeCss: `@page{margin:8mm;size:A4 ${drawLandscape ? "landscape" : "portrait"};}`,
  };
}

/**
 * Tisk: stránka 1 výkres (maximálně), legenda vpravo nebo na další stránce.
 */
export async function printAnnotatedCompositeCanvas(
  input: HTMLCanvasElement | AnnotatedCompositeResult,
  _title: string
): Promise<void> {
  const { bodyInner, pageSizeCss } = buildAnnotatedPrintDocumentBody(input);

  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    throw new Error("Prohlížeč zablokoval nové okno — povolte vyskakovací okna pro tisk.");
  }

  const html = `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><title>Tisk výkresu</title>
<style>${ANNOTATED_PRINT_PAGE_CSS}
  @media print{${pageSizeCss}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>${bodyInner}
<script>
(function(){
  function doPrint(){ try { window.focus(); window.print(); } catch(e) {} }
  var imgs = document.images, n = imgs.length, left = n;
  if (!n) { setTimeout(doPrint, 200); return; }
  function done(){ if (--left<=0) setTimeout(doPrint, 150); }
  for (var i=0;i<n;i++){
    if (imgs[i].complete) done();
    else { imgs[i].onload = done; imgs[i].onerror = done; }
  }
})();
<\/script></body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
