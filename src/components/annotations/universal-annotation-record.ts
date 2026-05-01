/**
 * Kanonický popis jedné anotace pro portál (mapuje se na JobPhotoAnnotation při serializaci).
 */
export type UniversalAnnotationRecordType =
  | "freehand"
  | "text"
  | "dimension"
  | "shapeLabel";

export type UniversalAnnotationRecord = {
  type: UniversalAnnotationRecordType;
  pageNumber?: number;
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  widthMm?: number;
  heightMm?: number;
  legendNumber?: number;
  showLabelInline?: boolean;
  color?: string;
  createdAt?: string;
};
