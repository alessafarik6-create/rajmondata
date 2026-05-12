/**
 * Opakovaně použitelné modely značek (legenda) — companies/{companyId}/annotationModels
 */

import type { DimensionColor } from "@/lib/job-photo-annotations";
import { DIMENSION_COLOR_HEX } from "@/lib/job-photo-annotations";

export type AnnotationModelShape = "square" | "rectangle" | "circle" | "point";

export type AnnotationModelDoc = {
  id: string;
  organizationId: string;
  name: string;
  widthMm: number;
  heightMm: number;
  shape: AnnotationModelShape;
  /** Např. #2563eb nebo název barvy */
  color: string;
  /** Text za rozměry v legendě, např. „přívod vody vlevo“. */
  legendDescription?: string;
  /** Interní poznámka ke šabloně (nelegenda). */
  note?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
};

export function annotationModelsCollectionPath(companyId: string): string {
  return `companies/${companyId}/annotationModels`;
}

function parseHexRgb(input: string): { r: number; g: number; b: number } | null {
  const t = input.trim();
  const m6 = /^#([0-9a-fA-F]{6})$/i.exec(t);
  if (m6) {
    const h = m6[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const m3 = /^#([0-9a-fA-F]{3})$/i.exec(t);
  if (m3) {
    const s = m3[1];
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  return null;
}

function nearestDimensionColorFromRgb(rgb: {
  r: number;
  g: number;
  b: number;
}): DimensionColor {
  const keys = Object.keys(DIMENSION_COLOR_HEX) as DimensionColor[];
  let best: DimensionColor = "blue";
  let bestD = Infinity;
  for (const k of keys) {
    const hx = DIMENSION_COLOR_HEX[k];
    const pr = parseHexRgb(hx);
    if (!pr) continue;
    const d =
      (pr.r - rgb.r) * (pr.r - rgb.r) +
      (pr.g - rgb.g) * (pr.g - rgb.g) +
      (pr.b - rgb.b) * (pr.b - rgb.b);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Barva z formuláře modelu → uložení do `strokeHex` značky (hex / CSS). */
export function modelColorToStrokeHex(color: string | undefined): string | undefined {
  const t = String(color ?? "").trim();
  if (!t) return undefined;
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/i.test(t)) return t;
  if (/^(rgb|hsl)a?\(/i.test(t)) return t;
  return t;
}

/**
 * Mapuje uloženou barvu modelu na paletu editoru (toolbar / serializované `color`).
 * U hexů vybere nejbližší z palety; u neznámých textů zachová heuristiku.
 */
export function dimensionColorFromModelColor(
  color: string | undefined
): DimensionColor {
  const t = String(color ?? "").trim();
  const rgb = parseHexRgb(t);
  if (rgb) {
    return nearestDimensionColorFromRgb(rgb);
  }
  const s = t.toLowerCase();
  if (s.includes("ff") && s.includes("eb")) return "yellow";
  if (s.includes("fff") || s === "white") return "white";
  if (s.includes("000") || s === "black") return "black";
  if (s.includes("3b") || s.includes("00f") || s === "blue") return "blue";
  if (s.includes("f00") || s.includes("e11") || s === "red") return "red";
  return "blue";
}
