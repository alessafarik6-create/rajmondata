/**
 * Editovatelné anotace u fotek zakázky — serializace do Firestore (normalizované souřadnice 0–1).
 */

export type DimensionColor = "red" | "yellow" | "white" | "black" | "blue";

export type ShapeLabelKind = "square" | "rectangle" | "circle" | "point";

export type JobPhotoDimensionAnnotation = {
  id: string;
  type: "dimension";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  label: string;
  color: DimensionColor;
  /** 0-based; u PDF stránka dokumentu (volitelné, výchozí 0). */
  pageIndex?: number;
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
  pageIndex?: number;
};

export type JobPhotoShapeLabelAnnotation = {
  id: string;
  type: "shapeLabel";
  shape: ShapeLabelKind;
  /** 0-based index stránky PDF; u obrázku 0. */
  pageIndex: number;
  /** Levý horní roh ohraničujícího obdélníku v pixelech dokumentu. */
  x: number;
  y: number;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  label: string;
  note?: string;
  legendNumber: number;
  showLabelInline: boolean;
  color: DimensionColor;
  createdAt?: number;
};

export type AnnotationLegendEntry = {
  legendNumber: number;
  label: string;
  widthMm: number;
  heightMm: number;
  note?: string;
};

export type JobPhotoAnnotation =
  | JobPhotoDimensionAnnotation
  | JobPhotoNoteAnnotation
  | JobPhotoShapeLabelAnnotation;

/** Verze payloadu; 2 = značky / legenda. */
export const JOB_PHOTO_ANNOTATION_VERSION = 2;
export const JOB_PHOTO_ANNOTATION_VERSION_LEGACY = 1;

export type JobPhotoAnnotationPayload = {
  version: number;
  imageWidth: number;
  imageHeight: number;
  /** 0-based; hlavní stránka uloženého výřezu (PDF). */
  pageIndex?: number;
  items: SerializedItem[];
  /** Odvozitelné ze značek, uloženo pro export a zobrazení mimo editor. */
  legend?: AnnotationLegendEntry[];
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
      pi?: number;
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
      pi?: number;
    }
  | {
      type: "shapeLabel";
      id: string;
      shape: ShapeLabelKind;
      pageIndex: number;
      sx: number;
      sy: number;
      sw: number;
      sh: number;
      widthMm: number;
      heightMm: number;
      label: string;
      note?: string;
      legendNumber: number;
      showLabelInline: boolean;
      color: DimensionColor;
      createdAt?: number;
    };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function buildLegendPayload(
  items: JobPhotoAnnotation[]
): AnnotationLegendEntry[] | undefined {
  const shapes = items.filter((a): a is JobPhotoShapeLabelAnnotation => a.type === "shapeLabel");
  if (!shapes.length) return undefined;
  const sorted = [...shapes].sort(
    (a, b) => a.legendNumber - b.legendNumber || a.id.localeCompare(b.id)
  );
  return sorted.map((s) => ({
    legendNumber: s.legendNumber,
    label: s.label || "",
    widthMm: s.widthMm,
    heightMm: s.heightMm,
    note: s.note?.trim() ? s.note.trim() : undefined,
  }));
}

export function serializeJobPhotoAnnotations(
  items: JobPhotoAnnotation[],
  imageWidth: number,
  imageHeight: number,
  opts?: { pageIndex?: number }
): JobPhotoAnnotationPayload {
  const iw = Math.max(1, Math.round(imageWidth));
  const ih = Math.max(1, Math.round(imageHeight));
  const pageIndex =
    typeof opts?.pageIndex === "number" && Number.isFinite(opts.pageIndex)
      ? Math.max(0, Math.floor(opts.pageIndex))
      : 0;

  const out: SerializedItem[] = [];
  let hasShape = false;
  for (const a of items) {
    if (a.type === "dimension") {
      const pi =
        typeof a.pageIndex === "number" && Number.isFinite(a.pageIndex)
          ? Math.max(0, Math.floor(a.pageIndex))
          : pageIndex;
      out.push({
        type: "dimension",
        id: a.id,
        sx: clamp01(a.startX / iw),
        sy: clamp01(a.startY / ih),
        ex: clamp01(a.endX / iw),
        ey: clamp01(a.endY / ih),
        label: a.label ?? "",
        color: a.color,
        pi,
      });
    } else if (a.type === "note") {
      const note = a as JobPhotoNoteAnnotation;
      const pi =
        typeof note.pageIndex === "number" && Number.isFinite(note.pageIndex)
          ? Math.max(0, Math.floor(note.pageIndex))
          : pageIndex;
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
        pi,
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
    } else if (a.type === "shapeLabel") {
      hasShape = true;
      const s = a as JobPhotoShapeLabelAnnotation;
      const pi =
        typeof s.pageIndex === "number" && Number.isFinite(s.pageIndex)
          ? Math.max(0, Math.floor(s.pageIndex))
          : pageIndex;
      out.push({
        type: "shapeLabel",
        id: s.id,
        shape: s.shape,
        pageIndex: pi,
        sx: clamp01(s.x / iw),
        sy: clamp01(s.y / ih),
        sw: clamp01(s.width / iw),
        sh: clamp01(s.height / ih),
        widthMm: Number.isFinite(s.widthMm) ? s.widthMm : 0,
        heightMm: Number.isFinite(s.heightMm) ? s.heightMm : 0,
        label: String(s.label ?? ""),
        note: s.note?.trim() ? s.note.trim() : undefined,
        legendNumber: Math.max(1, Math.floor(s.legendNumber || 1)),
        showLabelInline: Boolean(s.showLabelInline),
        color: s.color,
        createdAt: typeof s.createdAt === "number" ? s.createdAt : undefined,
      });
    }
  }

  const legend = buildLegendPayload(items);
  const version = hasShape || (legend && legend.length > 0) ? JOB_PHOTO_ANNOTATION_VERSION : JOB_PHOTO_ANNOTATION_VERSION_LEGACY;

  return {
    version,
    imageWidth: iw,
    imageHeight: ih,
    pageIndex,
    items: out,
    ...(legend && legend.length ? { legend } : {}),
  };
}

function parseShapeKind(v: unknown): ShapeLabelKind {
  const s = String(v || "").toLowerCase();
  if (s === "rectangle" || s === "rect") return "rectangle";
  if (s === "circle" || s === "ellipse") return "circle";
  if (s === "point" || s === "icon") return "point";
  return "square";
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

  const defaultPage =
    typeof payload.pageIndex === "number" && Number.isFinite(payload.pageIndex)
      ? Math.max(0, Math.floor(payload.pageIndex))
      : 0;

  const out: JobPhotoAnnotation[] = [];
  for (const it of payload.items) {
    if (!it || typeof it !== "object") continue;
    const t = (it as SerializedItem).type;
    if (t === "dimension") {
      const d = it as Extract<SerializedItem, { type: "dimension" }>;
      const pi = typeof d.pi === "number" && Number.isFinite(d.pi) ? Math.max(0, Math.floor(d.pi)) : defaultPage;
      out.push({
        id: String(d.id || createLocalId()),
        type: "dimension",
        startX: d.sx * iw,
        startY: d.sy * ih,
        endX: d.ex * iw,
        endY: d.ey * ih,
        label: String(d.label ?? ""),
        color: (d.color as DimensionColor) || "red",
        pageIndex: pi,
      });
    } else if (t === "note") {
      const n = it as Extract<SerializedItem, { type: "note" }>;
      const boxW = n.bw != null ? n.bw * iw : undefined;
      const boxH = n.bh != null ? n.bh * ih : undefined;
      const pi = typeof n.pi === "number" && Number.isFinite(n.pi) ? Math.max(0, Math.floor(n.pi)) : defaultPage;
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
        pageIndex: pi,
      };
      if (boxW != null && boxH != null && boxW > 1 && boxH > 1) {
        note.boxWidth = boxW;
        note.boxHeight = boxH;
      }
      out.push(note);
    } else if (t === "shapeLabel") {
      const s = it as Extract<SerializedItem, { type: "shapeLabel" }>;
      const pi =
        typeof s.pageIndex === "number" && Number.isFinite(s.pageIndex)
          ? Math.max(0, Math.floor(s.pageIndex))
          : defaultPage;
      out.push({
        id: String(s.id || createLocalId()),
        type: "shapeLabel",
        shape: parseShapeKind(s.shape),
        pageIndex: pi,
        x: s.sx * iw,
        y: s.sy * ih,
        width: Math.max(1, s.sw * iw),
        height: Math.max(1, s.sh * ih),
        widthMm: typeof s.widthMm === "number" ? s.widthMm : 0,
        heightMm: typeof s.heightMm === "number" ? s.heightMm : 0,
        label: String(s.label ?? ""),
        note: typeof s.note === "string" ? s.note : undefined,
        legendNumber: Math.max(1, Math.floor(Number(s.legendNumber) || 1)),
        showLabelInline: Boolean(s.showLabelInline),
        color: (s.color as DimensionColor) || "blue",
        createdAt: typeof s.createdAt === "number" ? s.createdAt : undefined,
      });
    }
  }
  return out;
}

/** Přečísluje legendNumber u značek 1…n podle stávajícího pořadí. */
export function renumberShapeLabelLegends(items: JobPhotoAnnotation[]): JobPhotoAnnotation[] {
  const shapes = items.filter((a): a is JobPhotoShapeLabelAnnotation => a.type === "shapeLabel");
  shapes.sort(
    (a, b) => a.legendNumber - b.legendNumber || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id)
  );
  const idToNum = new Map<string, number>();
  shapes.forEach((s, i) => idToNum.set(s.id, i + 1));
  return items.map((a) => {
    if (a.type !== "shapeLabel") return a;
    const n = idToNum.get(a.id);
    return n != null ? { ...a, legendNumber: n } : a;
  });
}

export function nextShapeLegendNumber(items: JobPhotoAnnotation[]): number {
  let max = 0;
  for (const a of items) {
    if (a.type === "shapeLabel") max = Math.max(max, a.legendNumber || 0);
  }
  return max + 1;
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
