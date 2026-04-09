/**
 * Editovatelné anotace u fotek zakázky — serializace do Firestore (normalizované souřadnice 0–1).
 */

export type DimensionColor = "red" | "yellow" | "white" | "black" | "blue";

export type JobPhotoDimensionAnnotation = {
  id: string;
  type: "dimension";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  label: string;
  color: DimensionColor;
};

export type JobPhotoNoteAnnotation = {
  id: string;
  type: "note";
  targetX: number;
  targetY: number;
  boxX: number;
  boxY: number;
  text: string;
  color: DimensionColor;
  boxWidth?: number;
  boxHeight?: number;
  showArrow?: boolean;
};

export type JobPhotoAnnotation = JobPhotoDimensionAnnotation | JobPhotoNoteAnnotation;

export const JOB_PHOTO_ANNOTATION_VERSION = 1;

export type JobPhotoAnnotationPayload = {
  version: number;
  imageWidth: number;
  imageHeight: number;
  items: SerializedItem[];
};

type SerializedItem =
  | {
      type: "dimension";
      id: string;
      sx: number;
      sy: number;
      ex: number;
      ey: number;
      label: string;
      color: DimensionColor;
    }
  | {
      type: "note";
      id: string;
      bx: number;
      by: number;
      tx: number;
      ty: number;
      text: string;
      color: DimensionColor;
      bw?: number;
      bh?: number;
      arrow?: boolean;
    };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function serializeJobPhotoAnnotations(
  items: JobPhotoAnnotation[],
  imageWidth: number,
  imageHeight: number
): JobPhotoAnnotationPayload {
  const iw = Math.max(1, Math.round(imageWidth));
  const ih = Math.max(1, Math.round(imageHeight));

  const out: SerializedItem[] = [];
  for (const a of items) {
    if (a.type === "dimension") {
      out.push({
        type: "dimension",
        id: a.id,
        sx: clamp01(a.startX / iw),
        sy: clamp01(a.startY / ih),
        ex: clamp01(a.endX / iw),
        ey: clamp01(a.endY / ih),
        label: a.label ?? "",
        color: a.color,
      });
    } else if (a.type === "note") {
      const note = a as JobPhotoNoteAnnotation;
      const row: SerializedItem = {
        type: "note",
        id: note.id,
        bx: clamp01(note.boxX / iw),
        by: clamp01(note.boxY / ih),
        tx: clamp01(note.targetX / iw),
        ty: clamp01(note.targetY / ih),
        text: note.text ?? "",
        color: note.color,
        arrow: note.showArrow !== false,
      };
      if (
        typeof note.boxWidth === "number" &&
        typeof note.boxHeight === "number" &&
        note.boxWidth > 0 &&
        note.boxHeight > 0
      ) {
        row.bw = clamp01(note.boxWidth / iw);
        row.bh = clamp01(note.boxHeight / ih);
      }
      out.push(row);
    }
  }

  return { version: JOB_PHOTO_ANNOTATION_VERSION, imageWidth: iw, imageHeight: ih, items: out };
}

export function deserializeJobPhotoAnnotations(
  raw: unknown,
  imageWidth: number,
  imageHeight: number
): JobPhotoAnnotation[] {
  const iw = Math.max(1, Math.round(imageWidth));
  const ih = Math.max(1, Math.round(imageHeight));

  if (!raw || typeof raw !== "object") return [];
  const payload = raw as Partial<JobPhotoAnnotationPayload>;
  if (!Array.isArray(payload.items)) return [];

  const out: JobPhotoAnnotation[] = [];
  for (const it of payload.items) {
    if (!it || typeof it !== "object") continue;
    const t = (it as SerializedItem).type;
    if (t === "dimension") {
      const d = it as Extract<SerializedItem, { type: "dimension" }>;
      out.push({
        id: String(d.id || createLocalId()),
        type: "dimension",
        startX: d.sx * iw,
        startY: d.sy * ih,
        endX: d.ex * iw,
        endY: d.ey * ih,
        label: String(d.label ?? ""),
        color: (d.color as DimensionColor) || "red",
      });
    } else if (t === "note") {
      const n = it as Extract<SerializedItem, { type: "note" }>;
      const boxW = n.bw != null ? n.bw * iw : undefined;
      const boxH = n.bh != null ? n.bh * ih : undefined;
      const note: JobPhotoNoteAnnotation = {
        id: String(n.id || createLocalId()),
        type: "note",
        boxX: n.bx * iw,
        boxY: n.by * ih,
        targetX: n.tx * iw,
        targetY: n.ty * ih,
        text: String(n.text ?? ""),
        color: (n.color as DimensionColor) || "yellow",
        showArrow: n.arrow !== false,
      };
      if (boxW != null && boxH != null && boxW > 1 && boxH > 1) {
        note.boxWidth = boxW;
        note.boxHeight = boxH;
      }
      out.push(note);
    }
  }
  return out;
}

function createLocalId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readAnnotationPayloadFromPhotoDoc(
  photo: Record<string, unknown>
): unknown | null {
  const d = photo.annotationData;
  if (d != null && typeof d === "object") return d;
  const j = photo.annotationsJson;
  if (typeof j === "string" && j.trim()) {
    try {
      return JSON.parse(j) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/** Rozměry obrázku v době serializace (0–1 souřadnice se načítají vůči nim). */
export function readAnnotationPayloadReferenceSize(
  raw: unknown
): { width: number; height: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<JobPhotoAnnotationPayload>;
  const w = typeof p.imageWidth === "number" && p.imageWidth > 0 ? Math.round(p.imageWidth) : 0;
  const h = typeof p.imageHeight === "number" && p.imageHeight > 0 ? Math.round(p.imageHeight) : 0;
  if (w < 1 || h < 1) return null;
  return { width: w, height: h };
}
