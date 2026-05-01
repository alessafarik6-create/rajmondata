/**
 * Souřadnice anotací vs. obrazovka: dokument = vnitřní pixely canvasu (nebo PDF v „základním“ měřítku 1).
 * Mapování používá skutečný vykreslený obdélník bitmapy (object-fit: contain) vůči client souřadnicím.
 */

import {
  clientToCanvasImagePoint,
  clientToCanvasImagePointClamped,
  imageToClientPoint,
  type CanvasImagePoint,
} from "@/lib/annotation-view-coords";

export type AnnotationDocCoordOptions = {
  mediaKind: "image" | "pdf";
  /** Měřítko PDF stránky oproti základnímu viewportu (scale 1). */
  pdfScale: number;
};

/** Client → dokument (pixely v prostoru uložených anotací). */
export function screenToDocumentPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  opts: AnnotationDocCoordOptions
): CanvasImagePoint | null {
  const p = clientToCanvasImagePoint(canvas, clientX, clientY);
  if (!p) return null;
  if (opts.mediaKind === "pdf") {
    const s = Math.max(1e-6, opts.pdfScale);
    return { x: p.x / s, y: p.y / s };
  }
  return p;
}

/** Jako {@link screenToDocumentPoint}, ale bod mimo bitmapu se promítne na okraj (kreslení). */
export function screenToDocumentPointClamped(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  opts: AnnotationDocCoordOptions
): CanvasImagePoint {
  const p = clientToCanvasImagePointClamped(canvas, clientX, clientY);
  if (opts.mediaKind === "pdf") {
    const s = Math.max(1e-6, opts.pdfScale);
    return { x: p.x / s, y: p.y / s };
  }
  return p;
}

/** Dokument → střed pixelu v client souřadnicích (pro UI). */
export function documentToScreenPoint(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  opts: AnnotationDocCoordOptions
): { clientX: number; clientY: number } | null {
  const px = opts.mediaKind === "pdf" ? x * Math.max(1e-6, opts.pdfScale) : x;
  const py = opts.mediaKind === "pdf" ? y * Math.max(1e-6, opts.pdfScale) : y;
  return imageToClientPoint(canvas, px, py);
}
