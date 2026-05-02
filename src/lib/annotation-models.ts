/**
 * Opakovaně použitelné modely značek (legenda) — companies/{companyId}/annotationModels
 */

import type { DimensionColor } from "@/lib/job-photo-annotations";

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

/** Mapuje uloženou barvu modelu na paletu editoru. */
export function dimensionColorFromModelColor(
  color: string | undefined
): DimensionColor {
  const s = String(color || "").trim().toLowerCase();
  if (s.includes("ff") && s.includes("eb")) return "yellow";
  if (s.includes("fff") || s === "white") return "white";
  if (s.includes("000") || s === "black") return "black";
  if (s.includes("3b") || s.includes("00f") || s === "blue") return "blue";
  if (s.includes("f00") || s.includes("e11") || s === "red") return "red";
  return "blue";
}
