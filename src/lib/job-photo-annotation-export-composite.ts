/**
 * Skládá podklad (fotka / stránka PDF ve scale 1) + anotace + legenda do jednoho canvasu.
 * Stejná logika jako při ukládání anotovaného PNG v editoru zakázky.
 */

import { drawNoteAnnotationOnCanvas } from "@/lib/job-photo-annotation-canvas";
import { getScaleAwareSizes } from "@/lib/job-photo-annotation-ui-helpers";
import {
  buildArrowNoteLegendEntries,
  type JobPhotoAnnotation,
  type JobPhotoArrowNoteAnnotation,
  type JobPhotoDimensionAnnotation,
  type JobPhotoMeterAnnotation,
  type JobPhotoNoteAnnotation,
  type JobPhotoShapeLabelAnnotation,
} from "@/lib/job-photo-annotations";
import {
  buildLegendFromShapeLabels,
  drawLegendStrip,
  drawShapeLabelOnCanvas,
  estimateLegendStripHeight,
} from "@/lib/job-photo-shape-label";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type AnnotationColorToHex = (color: JobPhotoAnnotation["color"]) => string;

function drawAnnotationsOnExportCanvas(
  targetCtx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  annotations: JobPhotoAnnotation[],
  colorToHex: AnnotationColorToHex
): void {
  const { fontSize, lineWidth, endpointRadius, arrowLen } =
    getScaleAwareSizes(canvas);

  const drawArrowHead = (x: number, y: number, ang: number, fill: string) => {
    targetCtx.fillStyle = fill;
    targetCtx.beginPath();
    targetCtx.moveTo(x, y);
    targetCtx.lineTo(
      x - arrowLen * Math.cos(ang - Math.PI / 6),
      y - arrowLen * Math.sin(ang - Math.PI / 6)
    );
    targetCtx.lineTo(
      x - arrowLen * Math.cos(ang + Math.PI / 6),
      y - arrowLen * Math.sin(ang + Math.PI / 6)
    );
    targetCtx.closePath();
    targetCtx.fill();
  };

  annotations.forEach((a) => {
    const stroke = colorToHex(a.color);
    const lw =
      typeof (a as { strokeWidth?: unknown }).strokeWidth === "number"
        ? Number((a as { strokeWidth: number }).strokeWidth)
        : lineWidth;
    targetCtx.lineWidth = lw;
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    targetCtx.strokeStyle = stroke;
    targetCtx.fillStyle = stroke;

    if (a.type === "dimension") {
      targetCtx.beginPath();
      targetCtx.moveTo(a.startX, a.startY);
      targetCtx.lineTo(a.endX, a.endY);
      targetCtx.stroke();

      const angle = Math.atan2(a.endY - a.startY, a.endX - a.startX);
      drawArrowHead(a.startX, a.startY, angle + Math.PI, stroke);
      drawArrowHead(a.endX, a.endY, angle, stroke);

      const label = (a.label || "").trim();
      if (label) {
        const dim = a as JobPhotoDimensionAnnotation;
        const lfRaw = dim.labelFontSize;
        const labelFs =
          typeof lfRaw === "number" && Number.isFinite(lfRaw)
            ? Math.max(1, Math.min(100, lfRaw))
            : 16;
        const labelPx = Math.max(1, labelFs);
        const midX = (a.startX + a.endX) / 2;
        const midY = (a.startY + a.endY) / 2;
        const offset = Math.max(10, labelPx * 0.85);
        const tx = midX - offset * Math.sin(angle);
        const ty = midY + offset * Math.cos(angle);
        targetCtx.font = `700 ${labelPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        targetCtx.textAlign = "center";
        targetCtx.textBaseline = "middle";
        targetCtx.lineWidth = Math.max(2, labelPx * 0.12);
        targetCtx.strokeStyle = "rgba(0,0,0,0.55)";
        targetCtx.strokeText(label, tx, ty);
        targetCtx.fillStyle = stroke;
        targetCtx.fillText(label, tx, ty);
      }
    }

    if (a.type === "meter") {
      const m = a as JobPhotoMeterAnnotation;
      targetCtx.save();
      targetCtx.setLineDash([5, 4]);
      targetCtx.lineWidth = lw;
      targetCtx.strokeStyle = stroke;
      targetCtx.beginPath();
      targetCtx.moveTo(m.startX, m.startY);
      targetCtx.lineTo(m.endX, m.endY);
      targetCtx.stroke();
      targetCtx.setLineDash([]);
      const lab = (m.label || "").trim();
      if (lab) {
        const midX = (m.startX + m.endX) / 2;
        const midY = (m.startY + m.endY) / 2;
        const ang = Math.atan2(m.endY - m.startY, m.endX - m.startX);
        const perp = ang - Math.PI / 2;
        const off = Math.max(12, fontSize * 0.55);
        const tx = midX + Math.cos(perp) * off;
        const ty = midY + Math.sin(perp) * off;
        const fontPx = Math.max(10, Math.round(fontSize * 0.72));
        targetCtx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
        targetCtx.textAlign = "center";
        targetCtx.textBaseline = "middle";
        targetCtx.lineWidth = Math.max(2, fontPx * 0.12);
        targetCtx.strokeStyle = "rgba(0,0,0,0.55)";
        targetCtx.strokeText(lab, tx, ty);
        targetCtx.fillStyle = "#f1f5f9";
        targetCtx.fillText(lab, tx, ty);
      }
      targetCtx.restore();
    }

    if (a.type === "arrowNote") {
      const ar = a as JobPhotoArrowNoteAnnotation;
      const sx = ar.startX;
      const sy = ar.startY;
      const ex = ar.endX;
      const ey = ar.endY;
      const angle = Math.atan2(ey - sy, ex - sx);
      targetCtx.lineWidth = lw;
      targetCtx.strokeStyle = stroke;
      targetCtx.beginPath();
      targetCtx.moveTo(sx, sy);
      targetCtx.lineTo(ex, ey);
      targetCtx.stroke();
      drawArrowHead(ex, ey, angle, stroke);
      const nfsRaw = ar.numFontSize;
      const nfs =
        typeof nfsRaw === "number" && Number.isFinite(nfsRaw)
          ? Math.max(8, Math.min(28, nfsRaw))
          : Math.min(18, Math.max(10, Math.round(fontSize * 0.52)));
      const r = Math.max(nfs * 0.72, 9);
      targetCtx.beginPath();
      targetCtx.arc(sx, sy, r, 0, Math.PI * 2);
      targetCtx.fillStyle = "rgba(255,255,255,0.94)";
      targetCtx.fill();
      targetCtx.strokeStyle = stroke;
      targetCtx.lineWidth = Math.max(1.25, 1.5);
      targetCtx.stroke();
      targetCtx.font = `700 ${nfs}px ui-sans-serif, system-ui, sans-serif`;
      targetCtx.textAlign = "center";
      targetCtx.textBaseline = "middle";
      targetCtx.fillStyle = stroke;
      targetCtx.fillText(String(ar.arrowNumber ?? ""), sx, sy);
    }

    if (a.type === "note") {
      drawNoteAnnotationOnCanvas(targetCtx, canvas, a as JobPhotoNoteAnnotation, false, {
        fontSize,
        lineWidth: lw,
        endpointRadius,
        arrowLen,
        colorToHex,
      });
    }

    if (a.type === "shapeLabel") {
      drawShapeLabelOnCanvas(
        targetCtx,
        a as JobPhotoShapeLabelAnnotation,
        false,
        1,
        colorToHex,
        fontSize,
        lw
      );
    }
  });
}

export type AnnotatedCompositeResult = {
  /** Celý rastr včetně legendy pod výkresem (pokud existuje). */
  composite: HTMLCanvasElement;
  /** Šířka/výška souřadnic dokumentu bez pruhu legendy — pro serializaci anotací. */
  documentWidth: number;
  documentHeight: number;
};

export async function buildAnnotatedCompositeCanvas(params: {
  mode: "pdf" | "image";
  pdfDocument: PDFDocumentProxy | null;
  /** 1-based index stránky (stejně jako `pdfPage` v editoru) */
  pdfPageOneBased: number;
  imageElement: HTMLImageElement | null;
  annotations: JobPhotoAnnotation[];
  colorToHex: AnnotationColorToHex;
}): Promise<AnnotatedCompositeResult> {
  const { mode, pdfDocument, pdfPageOneBased, imageElement, annotations, colorToHex } =
    params;
  const isPdf = mode === "pdf";

  const exportCanvas = document.createElement("canvas");
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Nepodařilo se inicializovat plátno pro export.");
  }

  if (isPdf) {
    if (!pdfDocument) {
      throw new Error("PDF dokument není k dispozici.");
    }
    const page = await pdfDocument.getPage(pdfPageOneBased);
    const vp = page.getViewport({ scale: 1 });
    exportCanvas.width = Math.max(1, Math.round(vp.width));
    exportCanvas.height = Math.max(1, Math.round(vp.height));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } else {
    if (!imageElement) {
      throw new Error("Chybí načtený obrázek.");
    }
    exportCanvas.width = imageElement.naturalWidth || imageElement.width;
    exportCanvas.height = imageElement.naturalHeight || imageElement.height;
    ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(imageElement, 0, 0);
  }

  drawAnnotationsOnExportCanvas(ctx, exportCanvas, annotations, colorToHex);

  const legendShapes = annotations.filter(
    (a): a is JobPhotoShapeLabelAnnotation => a.type === "shapeLabel"
  );
  const leg = [
    ...buildLegendFromShapeLabels(legendShapes),
    ...buildArrowNoteLegendEntries(annotations),
  ];
  let composite: HTMLCanvasElement = exportCanvas;
  if (leg.length > 0) {
    const legH = estimateLegendStripHeight(ctx, leg, exportCanvas.width);
    if (legH > 0) {
      const merged = document.createElement("canvas");
      merged.width = exportCanvas.width;
      merged.height = exportCanvas.height + legH;
      const mctx = merged.getContext("2d");
      if (mctx) {
        mctx.fillStyle = "#ffffff";
        mctx.fillRect(0, 0, merged.width, merged.height);
        mctx.drawImage(exportCanvas, 0, 0);
        drawLegendStrip(mctx, leg, merged.width, exportCanvas.height, legH);
        composite = merged;
      }
    }
  }

  return {
    composite,
    documentWidth: exportCanvas.width,
    documentHeight: exportCanvas.height,
  };
}

/** Zmenší canvas pro vložení do PDF (limity prohlížeče / jsPDF). */
export function scaleCanvasMaxSide(
  source: HTMLCanvasElement,
  maxSide: number
): HTMLCanvasElement {
  const m = Math.max(source.width, source.height);
  if (m <= maxSide) return source;
  const s = maxSide / m;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * s));
  out.height = Math.max(1, Math.round(source.height * s));
  const o = out.getContext("2d");
  if (!o) return source;
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = "high";
  o.drawImage(source, 0, 0, out.width, out.height);
  return out;
}
