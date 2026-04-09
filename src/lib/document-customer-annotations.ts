/**
 * Klientské / sdílené vrstvy anotací nad médiem zakázky (Firestore: jobs/{jobId}/document_annotations).
 * Nezasahuje do annotationData na samotném souboru — ty zůstávají pro interní kóty.
 */


export const DOCUMENT_CUSTOMER_ANNOTATION_VERSION = 1;

export type AnnotationStrokeColor = "red" | "blue" | "yellow";
export type OverlayPoint = [number, number] | { x: number; y: number };

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
      points: OverlayPoint[];
      notes: ThreadNote[];
      createdBy?: string;
      createdByRole?: "admin" | "customer";
      role?: "admin" | "customer";
      createdAt?: number;
      updatedAt?: number;
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
      createdByRole?: "admin" | "customer";
      role?: "admin" | "customer";
      createdAt?: number;
      updatedAt?: number;
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
      createdByRole?: "admin" | "customer";
      role?: "admin" | "customer";
      createdAt?: number;
      updatedAt?: number;
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
      createdByRole?: "admin" | "customer";
      role?: "admin" | "customer";
      createdAt?: number;
      updatedAt?: number;
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
      createdByRole?: "admin" | "customer";
      role?: "admin" | "customer";
      createdAt?: number;
      updatedAt?: number;
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
      createdByRole?: "admin" | "customer";
      role?: "admin" | "customer";
      createdAt?: number;
      updatedAt?: number;
      style?: {
        lineWidth?: number;
        fillColor?: string | null;
      };
    };

export type CustomerAnnotationPayload = {
  version: number;
  items: CustomerOverlayItem[];
};

/** Schválení / připomínka k výkresu od zákazníka (Firestore: document_annotations). */
export type DocumentMediaReviewStatus = "pending" | "approved" | "commented";

export type DocumentAnnotationFirestoreDoc = {
  companyId: string;
  jobId: string;
  documentId: string;
  targetId?: string;
  targetType?: "image" | "pdf";
  fileId?: string;
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
  /** Stav schválení média zákazníkem. */
  reviewStatus?: DocumentMediaReviewStatus;
  /** Poznámka zákazníka při nesouhlasu (reviewStatus === "commented"). */
  customerComment?: string;
  customerCommentAt?: unknown;
  customerCommentBy?: string;
};

export type ParsedDocumentMediaReview = {
  status: DocumentMediaReviewStatus;
  customerComment: string;
  customerCommentAtMs: number | null;
  customerCommentBy: string | null;
};

const MAX_CUSTOMER_REVIEW_COMMENT = 8000;

export function parseDocumentMediaReview(
  raw: Record<string, unknown> | null | undefined
): ParsedDocumentMediaReview {
  const rs = raw?.reviewStatus;
  const status: DocumentMediaReviewStatus =
    rs === "approved" || rs === "commented" || rs === "pending" ? rs : "pending";
  const comment =
    typeof raw?.customerComment === "string"
      ? raw.customerComment.trim().slice(0, MAX_CUSTOMER_REVIEW_COMMENT)
      : "";
  let atMs: number | null = null;
  const cat = raw?.customerCommentAt;
  if (cat && typeof (cat as { toMillis?: () => number }).toMillis === "function") {
    atMs = (cat as { toMillis: () => number }).toMillis();
  } else if (cat && typeof (cat as { seconds?: number }).seconds === "number") {
    atMs = (cat as { seconds: number }).seconds * 1000;
  } else if (typeof cat === "number" && Number.isFinite(cat)) {
    atMs = cat;
  }
  const by =
    typeof raw?.customerCommentBy === "string" && raw.customerCommentBy.trim()
      ? raw.customerCommentBy.trim()
      : null;
  return {
    status,
    customerComment: comment,
    customerCommentAtMs: atMs,
    customerCommentBy: by,
  };
}

export function normalizeCustomerReviewComment(text: string): string {
  return String(text ?? "")
    .trim()
    .slice(0, MAX_CUSTOMER_REVIEW_COMMENT);
}

/**
 * Minimální záznam document_annotations (prázdný overlay) — např. schválení bez uložených čar.
 * Musí odpovídat validaci ve Firestore (`jobDocumentAnnotationPayloadOk`).
 */
export function buildEmptyCustomerOverlayAnnotationDoc(params: {
  companyId: string;
  jobId: string;
  storagePath: DocumentAnnotationStoragePath;
  mediaDocumentId: string;
  fileType: "image" | "pdf";
  userId: string;
}): DocumentAnnotationFirestoreDoc {
  const { companyId, jobId, storagePath, mediaDocumentId, fileType, userId } = params;
  const normalizedFileId = String(mediaDocumentId ?? "").trim();
  const docId = documentAnnotationDocId(storagePath, mediaDocumentId);
  const targetId = normalizedFileId || docId;
  const targetType: "image" | "pdf" = fileType;
  const photoId =
    storagePath.kind === "photos" && targetType === "image" && normalizedFileId
      ? normalizedFileId
      : undefined;
  const documentId =
    storagePath.kind === "folderImages" && normalizedFileId ? normalizedFileId : targetId;
  const payload = serializePayload([]);
  return {
    companyId,
    jobId,
    documentId,
    targetId,
    targetType,
    fileId: normalizedFileId || undefined,
    targetKind: storagePath.kind === "photos" ? "photos" : "folderImages",
    ...(storagePath.kind === "folderImages" && storagePath.folderId
      ? { folderId: storagePath.folderId, imageId: documentId }
      : {}),
    ...(photoId ? { photoId } : {}),
    mediaKind: fileType,
    type: "customer_overlay",
    data: payload,
    visibleFor: ["customer", "admin"],
    updatedBy: userId,
  };
}

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
    const createdByRole =
      o.createdByRole === "admin" || o.createdByRole === "customer"
        ? (o.createdByRole as "admin" | "customer")
        : undefined;
    const role =
      o.role === "admin" || o.role === "customer"
        ? (o.role as "admin" | "customer")
        : createdByRole;
    const createdAt =
      typeof o.createdAt === "number" && Number.isFinite(o.createdAt)
        ? o.createdAt
        : undefined;
    const updatedAt =
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
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
    if ((t === "draw" || t === "freeDraw") && Array.isArray(o.points)) {
      const pts: [number, number][] = [];
      for (const p of o.points) {
        const normalized = normalizePointTuple(p);
        if (normalized) pts.push(normalized);
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
          createdByRole,
          role,
          createdAt,
          updatedAt,
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
        createdByRole,
        role,
        createdAt,
        updatedAt,
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
        createdByRole,
        role,
        createdAt,
        updatedAt,
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
        createdByRole,
        role,
        createdAt,
        updatedAt,
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
        createdByRole,
        role,
        createdAt,
        updatedAt,
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
        createdByRole,
        role,
        createdAt,
        updatedAt,
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

function normalizePointTuple(point: unknown): [number, number] | null {
  if (Array.isArray(point) && point.length >= 2) {
    if (Array.isArray(point[0]) || Array.isArray(point[1])) return null;
    return [clamp01(Number(point[0])), clamp01(Number(point[1]))];
  }
  if (point && typeof point === "object") {
    const p = point as { x?: unknown; y?: unknown };
    if (typeof p.x === "number" && typeof p.y === "number") {
      return [clamp01(p.x), clamp01(p.y)];
    }
  }
  return null;
}

function normalizeDrawAnnotationForStorage(
  item: Extract<CustomerOverlayItem, { type: "draw" }>
): Record<string, unknown> {
  const points = item.points
    .map((point: OverlayPoint) => normalizePointTuple(point))
    .filter((point): point is [number, number] => Array.isArray(point))
    .map(([x, y]) => ({ x, y }));
  return {
    id: item.id,
    type: "draw",
    color: item.color,
    page: item.page,
    points,
    strokeWidth:
      typeof item.style?.lineWidth === "number" && Number.isFinite(item.style.lineWidth)
        ? item.style.lineWidth
        : 3,
    createdBy: item.createdBy ?? null,
    createdByRole:
      (item as { createdByRole?: "admin" | "customer" }).createdByRole ?? item.role ?? null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? Date.now(),
    role: item.role ?? null,
    notes: item.notes ?? [],
    style: item.style ?? { lineWidth: 3, fillColor: null },
  };
}

export function serializePayload(items: CustomerOverlayItem[]): CustomerAnnotationPayload {
  const normalizedItems = items.map((item) =>
    item.type === "draw" ? normalizeDrawAnnotationForStorage(item) : item
  );
  return {
    version: DOCUMENT_CUSTOMER_ANNOTATION_VERSION,
    items: normalizedItems as unknown as CustomerOverlayItem[],
  };
}
