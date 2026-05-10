/**
 * Editovatelné anotace u fotek zakázky — serializace do Firestore (normalizované souřadnice 0–1).
 */

import {
  effectiveShapeLabelMm,
  normalizeShapeLabelRotationDeg,
  shapeLabelAnnotationPixelRect,
} from "@/lib/shape-label-mm-scale";

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
  /** Volitelná tloušťka čáry v px (v souřadnicích dokumentu). */
  strokeWidth?: number;
  /** Velikost písma popisku kóty v px (1–100, dokumentové souřadnice). */
  labelFontSize?: number;
  /** 0-based; u PDF stránka dokumentu (volitelné, výchozí 0). */
  pageIndex?: number;
};

/** Měření vzdálenosti v mm (vyžaduje {@link JobPhotoAnnotationPayload.imageCalibration}). */
export type JobPhotoMeterAnnotation = {
  id: string;
  type: "meter";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Vzdálenost v mm (uloženo pro konzistentní zobrazení). */
  measuredMm: number;
  /** Zobrazený text (např. „1 250 mm“). */
  label: string;
  color: DimensionColor;
  strokeWidth?: number;
  pageIndex?: number;
};

/**
 * Šipka s číslem u štítku a popisem v legendě.
 * Start = pozice čísla/štítku, end = hrot šipky (směřuje na detail).
 */
export type JobPhotoArrowNoteAnnotation = {
  id: string;
  type: "arrowNote";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Pořadové číslo šipky (legenda i výkres). */
  arrowNumber: number;
  /** Popis do legendy (řádek „číslo – popis“). */
  description: string;
  color: DimensionColor;
  strokeWidth?: number;
  /** Velikost písma čísla v px (dokument), volitelné. */
  numFontSize?: number;
  pageIndex?: number;
  createdAt?: number;
  updatedAt?: number;
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
  /** Volitelná tloušťka stroke pro box/šipku v px. */
  strokeWidth?: number;
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
  /** Text do legendy za rozměry (ze šablony nebo ručně). */
  legendDescription?: string;
  legendNumber: number;
  showLabelInline: boolean;
  color: DimensionColor;
  /** Volitelná tloušťka obrysu značky v px. */
  strokeWidth?: number;
  createdAt?: number;
  /** companies/.../annotationModels/{id} pokud značka vznikla ze šablony */
  modelId?: string;
  /** Úhel natočení ve stupních 0–360 (kolem středu boxu; rozměry v mm beze změny). */
  rotation?: number;
};

export type AnnotationLegendEntry = {
  legendNumber: number;
  label: string;
  widthMm: number;
  heightMm: number;
  /** Popis v legendě za rozměry. */
  legendDescription?: string;
  note?: string;
  /** Řádek šipky: „číslo – popis“ bez mm (podsekce v legendě). */
  arrowNote?: boolean;
};

/** Vložené instance modelů z knihovny (odkaz na anotaci + model). */
export type AnnotationPlacedModelRef = {
  annotationId: string;
  modelId: string;
};

export type JobPhotoAnnotation =
  | JobPhotoDimensionAnnotation
  | JobPhotoNoteAnnotation
  | JobPhotoShapeLabelAnnotation
  | JobPhotoMeterAnnotation
  | JobPhotoArrowNoteAnnotation;

/** Verze payloadu; 3 = měřítko / metr / font kóty; 2 = značky / legenda; 1 = starší. */
export const JOB_PHOTO_ANNOTATION_VERSION = 3;
/** Uložené soubory pouze se značkami (zpětná kompatibilita). */
export const JOB_PHOTO_ANNOTATION_VERSION_SHAPE_LABELS = 2;
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
  /** Značky vzniklé ze šablony modelu (duplicitní informace k items pro export/reporty). */
  placedModels?: AnnotationPlacedModelRef[];
  /**
   * Kalibrace měřítka: pixely na 1 mm v prostoru dokumentu (`mm = px / pxPerMm`).
   * Společné pro nástroj Metr a případné další výpočty.
   */
  imageCalibration?: { pxPerMm: number };
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
      lw?: number;
      /** Velikost fontu popisku kóty (px). */
      lf?: number;
      pi?: number;
    }
  | {
      type: "meter";
      id: string;
      sx: number;
      sy: number;
      ex: number;
      ey: number;
      mm: number;
      lab: string;
      color: DimensionColor;
      lw?: number;
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
      lw?: number;
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
      legendDescription?: string;
      legendNumber: number;
      showLabelInline: boolean;
      color: DimensionColor;
      lw?: number;
      createdAt?: number;
      modelId?: string;
      /** Úhel ve stupních (uložený klíč `rot`). */
      rot?: number;
    }
  | {
      type: "arrowNote";
      id: string;
      sx: number;
      sy: number;
      ex: number;
      ey: number;
      num: number;
      desc: string;
      color: DimensionColor;
      lw?: number;
      nfs?: number;
      pi?: number;
      ca?: number;
      ua?: number;
    };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Řádky legendy pro šipky (řazeno podle čísla). */
export function buildArrowNoteLegendEntries(
  items: JobPhotoAnnotation[]
): AnnotationLegendEntry[] {
  const arrows = items.filter((a): a is JobPhotoArrowNoteAnnotation => a.type === "arrowNote");
  if (!arrows.length) return [];
  return [...arrows]
    .sort(
      (a, b) =>
        (a.arrowNumber || 0) - (b.arrowNumber || 0) || a.id.localeCompare(b.id)
    )
    .map((a) => ({
      legendNumber: Math.max(1, Math.floor(a.arrowNumber || 1)),
      label: (a.description || "").trim(),
      widthMm: 0,
      heightMm: 0,
      arrowNote: true as const,
    }));
}

/** Další volné číslo šipky (max existujících + 1, bez přečíslování po smazání). */
export function nextArrowNoteNumber(items: JobPhotoAnnotation[]): number {
  let max = 0;
  for (const a of items) {
    if (a.type !== "arrowNote") continue;
    const n = Math.floor(Number((a as JobPhotoArrowNoteAnnotation).arrowNumber) || 0);
    if (n > max) max = n;
  }
  return max + 1;
}

function buildLegendPayload(
  items: JobPhotoAnnotation[]
): AnnotationLegendEntry[] | undefined {
  const shapes = items.filter((a): a is JobPhotoShapeLabelAnnotation => a.type === "shapeLabel");
  const sorted = [...shapes].sort(
    (a, b) => a.legendNumber - b.legendNumber || a.id.localeCompare(b.id)
  );
  const seen = new Set<number>();
  const shapeEntries: AnnotationLegendEntry[] = [];
  for (const s of sorted) {
    const ln = Math.max(1, Math.floor(s.legendNumber || 1));
    if (seen.has(ln)) continue;
    seen.add(ln);
    const effMm = effectiveShapeLabelMm(s.widthMm, s.heightMm);
    const entry: AnnotationLegendEntry = {
      legendNumber: ln,
      label: s.label || "",
      widthMm: effMm.widthMm,
      heightMm: effMm.heightMm,
    };
    const ld = s.legendDescription?.trim();
    if (ld) entry.legendDescription = ld;
    const nt = s.note?.trim();
    if (nt) entry.note = nt;
    shapeEntries.push(entry);
  }
  const arrowEntries = buildArrowNoteLegendEntries(items);
  const out = [...shapeEntries, ...arrowEntries];
  return out.length ? out : undefined;
}

export function formatMeasuredMmCs(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return "0 mm";
  return `${Math.round(mm).toLocaleString("cs-CZ")} mm`;
}

export function readImageCalibrationFromPayload(
  raw: unknown
): { pxPerMm: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const ic = p.imageCalibration;
  if (!ic || typeof ic !== "object") return null;
  const pxPerMm = Number((ic as { pxPerMm?: unknown }).pxPerMm);
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return null;
  return { pxPerMm };
}

export function serializeJobPhotoAnnotations(
  items: JobPhotoAnnotation[],
  imageWidth: number,
  imageHeight: number,
  opts?: {
    pageIndex?: number;
    imageCalibration?: { pxPerMm: number } | null;
  }
): JobPhotoAnnotationPayload {
  const iw = Math.max(1, Math.round(imageWidth));
  const ih = Math.max(1, Math.round(imageHeight));
  const pageIndex =
    typeof opts?.pageIndex === "number" && Number.isFinite(opts.pageIndex)
      ? Math.max(0, Math.floor(opts.pageIndex))
      : 0;

  const out: SerializedItem[] = [];
  let hasShape = false;
  let hasMeter = false;
  let hasArrowNote = false;
  for (const a of items) {
    if (a.type === "dimension") {
      const pi =
        typeof a.pageIndex === "number" && Number.isFinite(a.pageIndex)
          ? Math.max(0, Math.floor(a.pageIndex))
          : pageIndex;
      const d = a as JobPhotoDimensionAnnotation;
      out.push({
        type: "dimension",
        id: a.id,
        sx: clamp01(a.startX / iw),
        sy: clamp01(a.startY / ih),
        ex: clamp01(a.endX / iw),
        ey: clamp01(a.endY / ih),
        label: a.label ?? "",
        color: a.color,
        ...(typeof a.strokeWidth === "number" && Number.isFinite(a.strokeWidth) ? { lw: a.strokeWidth } : {}),
        ...(typeof d.labelFontSize === "number" &&
        Number.isFinite(d.labelFontSize) &&
        d.labelFontSize >= 1 &&
        d.labelFontSize <= 100
          ? { lf: d.labelFontSize }
          : {}),
        pi,
      });
    } else if (a.type === "meter") {
      hasMeter = true;
      const m = a as JobPhotoMeterAnnotation;
      const pi =
        typeof m.pageIndex === "number" && Number.isFinite(m.pageIndex)
          ? Math.max(0, Math.floor(m.pageIndex))
          : pageIndex;
      out.push({
        type: "meter",
        id: m.id,
        sx: clamp01(m.startX / iw),
        sy: clamp01(m.startY / ih),
        ex: clamp01(m.endX / iw),
        ey: clamp01(m.endY / ih),
        mm: Number.isFinite(m.measuredMm) ? m.measuredMm : 0,
        lab: String(m.label ?? ""),
        color: m.color,
        ...(typeof m.strokeWidth === "number" && Number.isFinite(m.strokeWidth) ? { lw: m.strokeWidth } : {}),
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
        ...(typeof note.strokeWidth === "number" && Number.isFinite(note.strokeWidth) ? { lw: note.strokeWidth } : {}),
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
    } else if (a.type === "arrowNote") {
      hasArrowNote = true;
      const ar = a as JobPhotoArrowNoteAnnotation;
      const pi =
        typeof ar.pageIndex === "number" && Number.isFinite(ar.pageIndex)
          ? Math.max(0, Math.floor(ar.pageIndex))
          : pageIndex;
      const row: Extract<SerializedItem, { type: "arrowNote" }> = {
        type: "arrowNote",
        id: ar.id,
        sx: clamp01(ar.startX / iw),
        sy: clamp01(ar.startY / ih),
        ex: clamp01(ar.endX / iw),
        ey: clamp01(ar.endY / ih),
        num: Math.max(1, Math.floor(ar.arrowNumber || 1)),
        desc: String(ar.description ?? ""),
        color: ar.color,
        ...(typeof ar.strokeWidth === "number" && Number.isFinite(ar.strokeWidth)
          ? { lw: ar.strokeWidth }
          : {}),
        ...(typeof ar.numFontSize === "number" &&
        Number.isFinite(ar.numFontSize) &&
        ar.numFontSize >= 8 &&
        ar.numFontSize <= 28
          ? { nfs: ar.numFontSize }
          : {}),
        pi,
        ...(typeof ar.createdAt === "number" && Number.isFinite(ar.createdAt)
          ? { ca: ar.createdAt }
          : {}),
        ...(typeof ar.updatedAt === "number" && Number.isFinite(ar.updatedAt)
          ? { ua: ar.updatedAt }
          : {}),
      };
      out.push(row);
    } else if (a.type === "shapeLabel") {
      hasShape = true;
      const s = a as JobPhotoShapeLabelAnnotation;
      const pi =
        typeof s.pageIndex === "number" && Number.isFinite(s.pageIndex)
          ? Math.max(0, Math.floor(s.pageIndex))
          : pageIndex;
      const row: Extract<SerializedItem, { type: "shapeLabel" }> = {
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
        legendNumber: Math.max(1, Math.floor(s.legendNumber || 1)),
        showLabelInline: Boolean(s.showLabelInline),
        color: s.color,
        ...(typeof s.strokeWidth === "number" && Number.isFinite(s.strokeWidth) ? { lw: s.strokeWidth } : {}),
      };
      const nt = s.note?.trim();
      if (nt) row.note = nt;
      const ld = s.legendDescription?.trim();
      if (ld) row.legendDescription = ld;
      if (typeof s.createdAt === "number" && Number.isFinite(s.createdAt)) {
        row.createdAt = s.createdAt;
      }
      const mid = typeof s.modelId === "string" ? s.modelId.trim() : "";
      if (mid) row.modelId = mid;
      const rotDeg = Number((s as { rotation?: unknown }).rotation);
      if (Number.isFinite(rotDeg)) {
        const rn = normalizeShapeLabelRotationDeg(rotDeg);
        if (rn !== 0) row.rot = rn;
      }
      out.push(row);
    }
  }

  const legend = buildLegendPayload(items);
  const placedModels: AnnotationPlacedModelRef[] = items
    .filter((a): a is JobPhotoShapeLabelAnnotation => a.type === "shapeLabel")
    .map((a) => {
      const mid = typeof a.modelId === "string" ? a.modelId.trim() : "";
      if (!mid) return null;
      return { annotationId: a.id, modelId: mid };
    })
    .filter((x): x is AnnotationPlacedModelRef => x != null);
  const cal =
    opts?.imageCalibration &&
    typeof opts.imageCalibration.pxPerMm === "number" &&
    Number.isFinite(opts.imageCalibration.pxPerMm) &&
    opts.imageCalibration.pxPerMm > 0
      ? { pxPerMm: opts.imageCalibration.pxPerMm }
      : null;
  const hasCalib = cal != null;
  const hasDimFont = items.some(
    (x) =>
      x.type === "dimension" &&
      typeof (x as JobPhotoDimensionAnnotation).labelFontSize === "number" &&
      Number.isFinite((x as JobPhotoDimensionAnnotation).labelFontSize)
  );
  const needV3 = hasMeter || hasCalib || hasDimFont || hasArrowNote;
  const needV2 = hasShape || (legend && legend.length > 0);
  const version = needV3
    ? JOB_PHOTO_ANNOTATION_VERSION
    : needV2
      ? JOB_PHOTO_ANNOTATION_VERSION_SHAPE_LABELS
      : JOB_PHOTO_ANNOTATION_VERSION_LEGACY;

  return {
    version,
    imageWidth: iw,
    imageHeight: ih,
    pageIndex,
    items: out,
    ...(legend && legend.length ? { legend } : {}),
    ...(placedModels.length ? { placedModels } : {}),
    ...(hasCalib ? { imageCalibration: cal! } : {}),
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
      const lfRaw = (d as { lf?: unknown }).lf;
      const labelFontSize =
        typeof lfRaw === "number" && Number.isFinite(lfRaw)
          ? Math.max(1, Math.min(100, Math.round(lfRaw)))
          : undefined;
      out.push({
        id: String(d.id || createLocalId()),
        type: "dimension",
        startX: d.sx * iw,
        startY: d.sy * ih,
        endX: d.ex * iw,
        endY: d.ey * ih,
        label: String(d.label ?? ""),
        color: (d.color as DimensionColor) || "red",
        strokeWidth: typeof (d as { lw?: unknown }).lw === "number" ? (d as { lw: number }).lw : undefined,
        ...(labelFontSize != null ? { labelFontSize } : {}),
        pageIndex: pi,
      });
    } else if (t === "meter") {
      const m = it as Extract<SerializedItem, { type: "meter" }>;
      const pi = typeof m.pi === "number" && Number.isFinite(m.pi) ? Math.max(0, Math.floor(m.pi)) : defaultPage;
      const mm = Number.isFinite(m.mm) ? m.mm : 0;
      const lab = String(m.lab ?? "").trim() || formatMeasuredMmCs(mm);
      out.push({
        id: String(m.id || createLocalId()),
        type: "meter",
        startX: m.sx * iw,
        startY: m.sy * ih,
        endX: m.ex * iw,
        endY: m.ey * ih,
        measuredMm: mm,
        label: lab,
        color: (m.color as DimensionColor) || "white",
        strokeWidth: typeof (m as { lw?: unknown }).lw === "number" ? (m as { lw: number }).lw : undefined,
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
        strokeWidth: typeof (n as { lw?: unknown }).lw === "number" ? (n as { lw: number }).lw : undefined,
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
      const cx = (s.sx + s.sw / 2) * iw;
      const cy = (s.sy + s.sh / 2) * ih;
      const rawWm = typeof s.widthMm === "number" ? s.widthMm : 0;
      const rawHm = typeof s.heightMm === "number" ? s.heightMm : 0;
      const effMm = effectiveShapeLabelMm(rawWm, rawHm);
      const shapeKind = parseShapeKind(s.shape);
      const rect = shapeLabelAnnotationPixelRect(
        shapeKind,
        effMm.widthMm,
        effMm.heightMm,
        iw,
        ih
      );
      const shapeRow: JobPhotoShapeLabelAnnotation = {
        id: String(s.id || createLocalId()),
        type: "shapeLabel",
        shape: shapeKind,
        pageIndex: pi,
        x: cx - rect.width / 2,
        y: cy - rect.height / 2,
        width: rect.width,
        height: rect.height,
        widthMm: effMm.widthMm,
        heightMm: effMm.heightMm,
        label: String(s.label ?? ""),
        note: typeof s.note === "string" ? s.note : undefined,
        legendDescription:
          typeof (s as { legendDescription?: string }).legendDescription === "string"
            ? (s as { legendDescription?: string }).legendDescription
            : undefined,
        legendNumber: Math.max(1, Math.floor(Number(s.legendNumber) || 1)),
        showLabelInline: Boolean(s.showLabelInline),
        color: (s.color as DimensionColor) || "blue",
        strokeWidth: typeof (s as { lw?: unknown }).lw === "number" ? (s as { lw: number }).lw : undefined,
        createdAt: typeof s.createdAt === "number" ? s.createdAt : undefined,
      };
      const mid =
        typeof (s as { modelId?: string }).modelId === "string"
          ? (s as { modelId?: string }).modelId?.trim()
          : "";
      if (mid) shapeRow.modelId = mid;
      const rotRaw = (s as { rot?: unknown }).rot;
      const rotNum = Number(rotRaw);
      if (Number.isFinite(rotNum)) {
        shapeRow.rotation = normalizeShapeLabelRotationDeg(rotNum);
      }
      out.push(shapeRow);
    } else if (t === "arrowNote") {
      const ar = it as Extract<SerializedItem, { type: "arrowNote" }>;
      const pi = typeof ar.pi === "number" && Number.isFinite(ar.pi) ? Math.max(0, Math.floor(ar.pi)) : defaultPage;
      const nfsRaw = (ar as { nfs?: unknown }).nfs;
      const numFontSize =
        typeof nfsRaw === "number" && Number.isFinite(nfsRaw)
          ? Math.max(8, Math.min(28, Math.round(nfsRaw)))
          : undefined;
      const caRaw = (ar as { ca?: unknown }).ca;
      const uaRaw = (ar as { ua?: unknown }).ua;
      out.push({
        id: String(ar.id || createLocalId()),
        type: "arrowNote",
        startX: ar.sx * iw,
        startY: ar.sy * ih,
        endX: ar.ex * iw,
        endY: ar.ey * ih,
        arrowNumber: Math.max(1, Math.floor(Number(ar.num) || 1)),
        description: String(ar.desc ?? ""),
        color: (ar.color as DimensionColor) || "red",
        strokeWidth: typeof (ar as { lw?: unknown }).lw === "number" ? (ar as { lw: number }).lw : undefined,
        ...(numFontSize != null ? { numFontSize } : {}),
        pageIndex: pi,
        ...(typeof caRaw === "number" && Number.isFinite(caRaw) ? { createdAt: caRaw } : {}),
        ...(typeof uaRaw === "number" && Number.isFinite(uaRaw) ? { updatedAt: uaRaw } : {}),
      });
    }
  }
  return out;
}

/**
 * Klíč skupiny legendy: stejný model (modelId) nebo stejné ruční zadání (název + mm + poznámka).
 * Více značek ve skupině sdílí jedno číslo v legendě.
 */
export function groupKeyForShapeLabel(s: JobPhotoShapeLabelAnnotation): string {
  const mid = s.modelId?.trim();
  if (mid) return `m:${mid}`;
  const lab = (s.label || "").trim().toLowerCase();
  const note = (s.note ?? "").trim();
  const leg = (s.legendDescription ?? "").trim();
  return `f:${lab}|${Number(s.widthMm) || 0}|${Number(s.heightMm) || 0}|${note}|${leg}`;
}

/**
 * Přiřadí legendNumber podle skupin (model / stejné ruční parametry).
 * Zachová existující čísla ve skupině (min. legendNumber), nové skupiny dostanou neobsazené číslo.
 */
export function syncShapeLabelLegendNumbers(items: JobPhotoAnnotation[]): JobPhotoAnnotation[] {
  const shapes = items.filter((a): a is JobPhotoShapeLabelAnnotation => a.type === "shapeLabel");
  if (!shapes.length) return items;

  const byKey = new Map<string, JobPhotoShapeLabelAnnotation[]>();
  for (const s of shapes) {
    const k = groupKeyForShapeLabel(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }

  const keysSorted = [...byKey.keys()].sort((ka, kb) => {
    const minCreated = (arr: JobPhotoShapeLabelAnnotation[]) =>
      Math.min(...arr.map((x) => (typeof x.createdAt === "number" ? x.createdAt : 0)));
    const ca = minCreated(byKey.get(ka)!);
    const cb = minCreated(byKey.get(kb)!);
    return ca - cb || ka.localeCompare(kb);
  });

  const candidateForKey = (k: string): number => {
    const arr = byKey.get(k)!;
    let mn = Infinity;
    for (const s of arr) {
      const n = Math.floor(Number(s.legendNumber));
      if (Number.isFinite(n) && n >= 1) mn = Math.min(mn, n);
    }
    return mn === Infinity ? -1 : mn;
  };

  const finalNum = new Map<string, number>();
  const taken = new Set<number>();

  for (const k of keysSorted) {
    let want = candidateForKey(k);
    if (want < 1 || taken.has(want)) {
      let x = taken.size ? Math.max(...taken) + 1 : 1;
      while (taken.has(x)) x += 1;
      want = x;
    }
    finalNum.set(k, want);
    taken.add(want);
  }

  return items.map((a) => {
    if (a.type !== "shapeLabel") return a;
    const num = finalNum.get(groupKeyForShapeLabel(a as JobPhotoShapeLabelAnnotation));
    return num != null ? { ...a, legendNumber: num } : a;
  });
}

/** @deprecated Use syncShapeLabelLegendNumbers */
export const renumberShapeLabelLegends = syncShapeLabelLegendNumbers;

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
