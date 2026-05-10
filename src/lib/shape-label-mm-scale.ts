/**
 * Měřítko značek (mm) → pixely v prostoru dokumentu anotací (stejné jako u kót).
 * Bez DPI metadat obrázku používáme konzistentní „virtuální“ měřítko vůči kratší straně bitmapy,
 * aby se poměr rozměrů (5 mm vs 10 mm vs 20 mm) choval předvídatelně.
 */

import type { ShapeLabelKind } from "@/lib/job-photo-annotations";

/** Kratší strana dokumentu (px) odpovídá této délce v mm pro výpočet velikosti značek. */
export const SHAPE_LABEL_REFERENCE_MM_ON_SHORT_SIDE = 200;

/** Staré anotace bez mm — výchozí pro legendu a přepočet pixelů. */
export const SHAPE_LABEL_LEGACY_FALLBACK_MM = 10;

export function effectiveShapeLabelMm(
  widthMm: number | undefined,
  heightMm: number | undefined
): { widthMm: number; heightMm: number } {
  const wm = Number(widthMm);
  const hm = Number(heightMm);
  const wOk = Number.isFinite(wm) && wm > 0;
  const hOk = Number.isFinite(hm) && hm > 0;
  if (wOk && hOk) return { widthMm: wm, heightMm: hm };
  return {
    widthMm: SHAPE_LABEL_LEGACY_FALLBACK_MM,
    heightMm: SHAPE_LABEL_LEGACY_FALLBACK_MM,
  };
}

/**
 * Velikost značky v pixelech dokumentu z rozměrů v mm.
 * Minimální rozměr je zanedbatelný (0,25 px) — ne přebíjí zadané mm; pro výběr slouží větší hitbox.
 */
export function shapeLabelDocumentPixelsFromMm(
  widthMm: number,
  heightMm: number,
  documentWidthPx: number,
  documentHeightPx: number
): { width: number; height: number } {
  const iw = Math.max(1, documentWidthPx);
  const ih = Math.max(1, documentHeightPx);
  const short = Math.min(iw, ih);
  const pxPerMm = short / SHAPE_LABEL_REFERENCE_MM_ON_SHORT_SIDE;
  const { widthMm: wm, heightMm: hm } = effectiveShapeLabelMm(widthMm, heightMm);
  return {
    width: Math.max(0.25, wm * pxPerMm),
    height: Math.max(0.25, hm * pxPerMm),
  };
}

/** Úhel značky ve stupních 0–360 (360 a 0 ekvivalentní). */
export function normalizeShapeLabelRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}

export function shapeLabelAnnotationPixelRect(
  shape: ShapeLabelKind,
  widthMm: number | undefined,
  heightMm: number | undefined,
  documentWidthPx: number,
  documentHeightPx: number
): { width: number; height: number } {
  const eff = effectiveShapeLabelMm(widthMm, heightMm);
  let { width, height } = shapeLabelDocumentPixelsFromMm(
    eff.widthMm,
    eff.heightMm,
    documentWidthPx,
    documentHeightPx
  );
  if (shape === "square" || shape === "circle" || shape === "point") {
    const side = Math.min(width, height);
    return { width: side, height: side };
  }
  return { width, height };
}
