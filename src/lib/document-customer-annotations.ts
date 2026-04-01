/**
 * Klientské / sdílené vrstvy anotací nad médiem zakázky (Firestore: jobs/{jobId}/document_annotations).
 * Nezasahuje do annotationData na samotném souboru — ty zůstávají pro interní kóty.
 */


export const DOCUMENT_CUSTOMER_ANNOTATION_VERSION = 1;

export type AnnotationStrokeColor = "red" | "blue" | "yellow";

export type ThreadNote = {
  id: string;
  text: string;
  createdBy: string;
  createdAt: number;
};

export type CustomerOverlayItem =
  | {
      id: string;
      type: "draw";
      color: AnnotationStrokeColor;
      page: number;
      points: [number, number][];
      notes: ThreadNote[];
      createdBy?: string;
      role?: "admin" | "customer";
      createdAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    }
  | {
      id: string;
      type: "line";
      color: AnnotationStrokeColor;
      page: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      notes: ThreadNote[];
      createdBy?: string;
      role?: "admin" | "customer";
      createdAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    }
  | {
      id: string;
      type: "text";
      color: AnnotationStrokeColor;
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      notes: ThreadNote[];
      createdBy?: string;
      role?: "admin" | "customer";
      createdAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    }
  | {
      id: string;
      type: "highlight";
      color: AnnotationStrokeColor;
      page: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      notes: ThreadNote[];
      createdBy?: string;
      role?: "admin" | "customer";
      createdAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    }
  | {
      id: string;
      type: "dimension";
      color: AnnotationStrokeColor;
      page: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      text: string;
      notes: ThreadNote[];
      createdBy?: string;
      role?: "admin" | "customer";
      createdAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    }
  | {
      id: string;
      type: "rectangle" | "square" | "circle";
      color: AnnotationStrokeColor;
      page: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      notes: ThreadNote[];
      createdBy?: string;
      role?: "admin" | "customer";
      createdAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    };

export type CustomerAnnotationPayload = {
  version: number;
  items: CustomerOverlayItem[];
};

export type DocumentAnnotationFirestoreDoc = {
  companyId: string;
  jobId: string;
  documentId: string;
  targetKind: "folderImages" | "photos";
  folderId?: string;
  imageId?: string;
  photoId?: string;
  mediaKind: "image" | "pdf";
  type: "customer_overlay";
  data: CustomerAnnotationPayload;
  visibleFor: string[];
  updatedBy: string;
  updatedAt?: unknown;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeDocIdSegment(s: string): string {
  return String(s || "")
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200);
}

export type DocumentAnnotationStoragePath =
  | { kind: "photos" }
  | { kind: "folderImages"; folderId: string };

/** ID dokumentu ve Firestore — stabilní podle média. */
export function documentAnnotationDocId(
  path: DocumentAnnotationStoragePath,
  imageOrPhotoId: string
): string {
  const id = safeDocIdSegment(imageOrPhotoId);
  if (path.kind === "photos") return `ph_${id}`;
  return `fi_${safeDocIdSegment(path.folderId)}__${id}`;
}

export function parseDocumentAnnotationDoc(
  raw: Record<string, unknown> | null | undefined
): CustomerAnnotationPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw.data as unknown;
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<CustomerAnnotationPayload>;
  if (d.version !== DOCUMENT_CUSTOMER_ANNOTATION_VERSION || !Array.isArray(d.items)) {
    return null;
  }
  return { version: DOCUMENT_CUSTOMER_ANNOTATION_VERSION, items: sanitizeItems(d.items) };
}

function sanitizeItems(raw: unknown[]): CustomerOverlayItem[] {
  const out: CustomerOverlayItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const id = String(o.id || "");
    const rawC = o.color;
    const color: AnnotationStrokeColor =
      rawC === "red" || rawC === "blue" || rawC === "yellow" ? rawC : "red";
    const page = typeof o.page === "number" && o.page >= 0 ? Math.floor(o.page) : 0;
    const notes = parseNotes(o.notes);
    const createdBy =
      typeof o.createdBy === "string" && o.createdBy.trim() ? String(o.createdBy) : undefined;
    const role =
      o.role === "admin" || o.role === "customer"
        ? (o.role as "admin" | "customer")
        : undefined;
    const createdAt =
      typeof o.createdAt === "number" && Number.isFinite(o.createdAt)
        ? o.createdAt
        : undefined;
    const style =
      o.style && typeof o.style === "object"
        ? {
            lineWidth:
              typeof (o.style as { lineWidth?: unknown }).lineWidth === "number"
                ? Number((o.style as { lineWidth: number }).lineWidth)
                : undefined,
            fillColor:
              typeof (o.style as { fillColor?: unknown }).fillColor === "string"
                ? String((o.style as { fillColor: string }).fillColor)
                : null,
          }
        : undefined;
    const t = o.type;
    if (t === "draw" && Array.isArray(o.points)) {
      const pts: [number, number][] = [];
      for (const p of o.points) {
        if (Array.isArray(p) && p.length >= 2) {
          pts.push([clamp01(Number(p[0])), clamp01(Number(p[1]))]);
        }
      }
      if (pts.length >= 2) {
        out.push({
          id: id || newItemId(),
          type: "draw",
          color,
          page,
          points: pts,
          notes,
          createdBy,
          role,
          createdAt,
          style,
        });
      }
    } else if (t === "line") {
      out.push({
        id: id || newItemId(),
        type: "line",
        color,
        page,
        x1: clamp01(Number(o.x1)),
        y1: clamp01(Number(o.y1)),
        x2: clamp01(Number(o.x2)),
        y2: clamp01(Number(o.y2)),
        notes,
        createdBy,
        role,
        createdAt,
        style,
      });
    } else if (t === "text") {
      const text = String(o.text ?? "").slice(0, 4000);
      out.push({
        id: id || newItemId(),
        type: "text",
        color,
        page,
        x: clamp01(Number(o.x)),
        y: clamp01(Number(o.y)),
        w: clamp01(Number(o.w)) || 0.1,
        h: clamp01(Number(o.h)) || 0.04,
        text,
        notes,
        createdBy,
        role,
        createdAt,
        style,
      });
    } else if (t === "highlight") {
      out.push({
        id: id || newItemId(),
        type: "highlight",
        color,
        page,
        x1: clamp01(Number(o.x1)),
        y1: clamp01(Number(o.y1)),
        x2: clamp01(Number(o.x2)),
        y2: clamp01(Number(o.y2)),
        notes,
        createdBy,
        role,
        createdAt,
        style,
      });
    } else if (t === "dimension") {
      out.push({
        id: id || newItemId(),
        type: "dimension",
        color,
        page,
        x1: clamp01(Number(o.x1)),
        y1: clamp01(Number(o.y1)),
        x2: clamp01(Number(o.x2)),
        y2: clamp01(Number(o.y2)),
        text: String(o.text ?? "").slice(0, 120),
        notes,
        createdBy,
        role,
        createdAt,
        style,
      });
    } else if (t === "rectangle" || t === "square" || t === "circle") {
      out.push({
        id: id || newItemId(),
        type: t as "rectangle" | "square" | "circle",
        color,
        page,
        x1: clamp01(Number(o.x1)),
        y1: clamp01(Number(o.y1)),
        x2: clamp01(Number(o.x2)),
        y2: clamp01(Number(o.y2)),
        notes,
        createdBy,
        role,
        createdAt,
        style,
      });
    }
  }
  return out;
}

function parseNotes(raw: unknown): ThreadNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadNote[] = [];
  for (const n of raw) {
    if (!n || typeof n !== "object") continue;
    const r = n as Record<string, unknown>;
    const text = String(r.text ?? "").trim().slice(0, 2000);
    if (!text) continue;
    out.push({
      id: String(r.id || newItemId()),
      text,
      createdBy: String(r.createdBy ?? ""),
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    });
  }
  return out;
}

export function newItemId(): string {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function serializePayload(items: CustomerOverlayItem[]): CustomerAnnotationPayload {
  return { version: DOCUMENT_CUSTOMER_ANNOTATION_VERSION, items };
}
