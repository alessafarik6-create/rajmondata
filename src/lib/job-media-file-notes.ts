/**
 * Poznámky u výkresu / souboru zakázky (Firestore: jobs/{jobId}/media_notes).
 */

import { safeTime } from "@/lib/date-safe";
import { buildMessageAuthorPersistFields } from "@/lib/format-message-date";
import { readAnnotationPayloadFromPhotoDoc } from "@/lib/job-photo-annotations";

export type JobMediaNoteAuthorType = "customer" | "admin" | "employee";
export type JobMediaNoteSource = "customerPortal" | "admin" | "employee" | "approval" | "legacy";

export type JobMediaFileNoteDoc = {
  id: string;
  companyId: string;
  jobId: string;
  fileId: string;
  mediaId?: string | null;
  imageId?: string | null;
  documentId?: string | null;
  photoId?: string | null;
  targetId?: string | null;
  folderId?: string | null;
  authorType: JobMediaNoteAuthorType;
  authorId: string;
  authorName: string;
  text: string;
  visibleToCustomer: boolean;
  source: JobMediaNoteSource;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type JobMediaFileNoteTarget = {
  fileId: string;
  folderId?: string | null;
  fileName?: string | null;
};

export function jobMediaNotesCollectionPath(
  companyId: string,
  jobId: string
): string {
  return `companies/${companyId}/jobs/${jobId}/media_notes`;
}

/** Všechna možná ID souboru z dokumentu poznámky (legacy pole). */
export function mediaNoteLinkedFileIds(note: Record<string, unknown>): string[] {
  const keys = ["fileId", "mediaId", "imageId", "documentId", "photoId", "targetId"] as const;
  const out: string[] = [];
  for (const k of keys) {
    const v = String(note[k] ?? "").trim();
    if (v) out.push(v);
  }
  return [...new Set(out)];
}

export function mediaNoteMatchesFile(
  note: Record<string, unknown>,
  target: JobMediaFileNoteTarget
): boolean {
  const fileId = String(target.fileId ?? "").trim();
  if (!fileId) return false;
  const linked = mediaNoteLinkedFileIds(note);
  if (!linked.includes(fileId)) return false;

  const noteFolder = note.folderId != null ? String(note.folderId).trim() : "";
  const targetFolder = target.folderId != null ? String(target.folderId).trim() : "";
  if (targetFolder && noteFolder && noteFolder !== targetFolder) return false;
  return true;
}

export function parseJobMediaFileNoteDoc(
  raw: Record<string, unknown> | null | undefined,
  id: string
): JobMediaFileNoteDoc | null {
  if (!raw) return null;
  const text = String(raw.text ?? raw.message ?? "").trim();
  if (!text) return null;

  const fileId =
    String(raw.fileId ?? raw.mediaId ?? raw.imageId ?? raw.documentId ?? raw.photoId ?? raw.targetId ?? "").trim();
  if (!fileId) return null;

  const authorTypeRaw = String(raw.authorType ?? raw.authorRole ?? "").toLowerCase();
  const authorType: JobMediaNoteAuthorType =
    authorTypeRaw === "customer"
      ? "customer"
      : authorTypeRaw === "employee"
        ? "employee"
        : "admin";

  const visibleRaw = raw.visibleToCustomer;
  const visibleToCustomer =
    visibleRaw === false || visibleRaw === "false"
      ? false
      : authorType === "customer"
        ? true
        : visibleRaw === true || visibleRaw === "true";

  const sourceRaw = String(raw.source ?? "").trim();
  const source: JobMediaNoteSource =
    sourceRaw === "customerPortal" ||
    sourceRaw === "admin" ||
    sourceRaw === "employee" ||
    sourceRaw === "approval" ||
    sourceRaw === "legacy"
      ? sourceRaw
      : authorType === "customer"
        ? "customerPortal"
        : "admin";

  return {
    id,
    companyId: String(raw.companyId ?? raw.organizationId ?? ""),
    jobId: String(raw.jobId ?? ""),
    fileId,
    mediaId: raw.mediaId != null ? String(raw.mediaId) : fileId,
    imageId: raw.imageId != null ? String(raw.imageId) : null,
    documentId: raw.documentId != null ? String(raw.documentId) : null,
    photoId: raw.photoId != null ? String(raw.photoId) : null,
    targetId: raw.targetId != null ? String(raw.targetId) : null,
    folderId: raw.folderId != null ? String(raw.folderId) : null,
    authorType,
    authorId: String(raw.authorId ?? raw.createdBy ?? ""),
    authorName:
      String(raw.authorName ?? raw.createdByName ?? "—").trim() || "—",
    text,
    visibleToCustomer,
    source,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function isMediaNoteVisibleToCustomer(note: JobMediaFileNoteDoc): boolean {
  return note.visibleToCustomer === true;
}

/** Zákazník: vlastní poznámky + admin/employee označené jako viditelné. */
export function filterMediaNotesForCustomerView(
  notes: JobMediaFileNoteDoc[],
  customerUid: string
): JobMediaFileNoteDoc[] {
  const uid = customerUid.trim();
  return notes.filter(
    (n) =>
      isMediaNoteVisibleToCustomer(n) ||
      (uid && n.authorId === uid && n.authorType === "customer")
  );
}

export type JobMediaNoteViewerRole = "admin" | "customer" | "employee";

function legacyCommentMatchesFileTarget(
  row: Record<string, unknown>,
  target: JobMediaFileNoteTarget,
  opts?: { legacyPhotos?: boolean }
): boolean {
  const fid = String(row.fileId ?? "").trim();
  if (fid !== String(target.fileId ?? "").trim()) return false;
  const cFolder = row.folderId != null ? String(row.folderId).trim() : "";
  const targetFolder = target.folderId != null ? String(target.folderId).trim() : "";
  if (opts?.legacyPhotos) {
    return !cFolder;
  }
  if (targetFolder) return cFolder === targetFolder;
  return true;
}

/** Textové poznámky z anotací (note / arrowNote / shapeLabel) na výkresu. */
export function countAnnotationTextNotesInPhotoDoc(
  fileRow: Record<string, unknown> | null | undefined
): number {
  const raw = readAnnotationPayloadFromPhotoDoc(fileRow ?? {});
  if (!raw || typeof raw !== "object") return 0;
  const annotations = (raw as { annotations?: unknown[] }).annotations;
  if (!Array.isArray(annotations)) return 0;
  let count = 0;
  for (const item of annotations) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const type = String(a.type ?? "");
    if (type === "note" && String(a.text ?? "").trim()) count += 1;
    if (type === "arrowNote" && String(a.description ?? "").trim()) count += 1;
    if (type === "shapeLabel") {
      if (String(a.note ?? "").trim()) count += 1;
      if (String(a.legendDescription ?? "").trim()) count += 1;
    }
  }
  return count;
}

/** Sjednocený seznam poznámek u souboru podle role prohlížeče. */
export function resolveVisibleFileNotesForTarget(params: {
  allNotes: JobMediaFileNoteDoc[];
  legacyComments?: Array<Record<string, unknown> & { id: string }>;
  target: JobMediaFileNoteTarget;
  legacyFileRow?: Record<string, unknown> | null;
  viewerRole: JobMediaNoteViewerRole;
  viewerUid?: string;
  legacyPhotos?: boolean;
}): JobMediaFileNoteDoc[] {
  let picked = pickMediaNotesForFile(params.allNotes, params.target);
  if (params.legacyFileRow) {
    picked = mergeFileMediaNotesWithLegacyApprovalComment(
      picked,
      params.legacyFileRow,
      params.target
    );
  }
  const seen = new Set(picked.map((n) => n.id));
  for (const row of params.legacyComments ?? []) {
    if (
      !legacyCommentMatchesFileTarget(row, params.target, {
        legacyPhotos: params.legacyPhotos,
      })
    ) {
      continue;
    }
    const legacy = commentRowToMediaNoteLike(row);
    if (!legacy || seen.has(legacy.id)) continue;
    if (params.viewerRole === "customer" && !isMediaNoteVisibleToCustomer(legacy)) {
      continue;
    }
    picked.push(legacy);
    seen.add(legacy.id);
  }
  picked = sortMediaNotesChronologically(picked);
  if (params.viewerRole === "customer") {
    picked = filterMediaNotesForCustomerView(picked, params.viewerUid ?? "");
  }
  return picked;
}

export function countVisibleFileNotesForTarget(
  params: Parameters<typeof resolveVisibleFileNotesForTarget>[0]
): number {
  const notes = resolveVisibleFileNotesForTarget(params);
  const annotations = countAnnotationTextNotesInPhotoDoc(params.legacyFileRow);
  return notes.length + annotations;
}

export function sortMediaNotesChronologically(notes: JobMediaFileNoteDoc[]): JobMediaFileNoteDoc[] {
  return notes.slice().sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt));
}

export function pickMediaNotesForFile(
  all: JobMediaFileNoteDoc[],
  target: JobMediaFileNoteTarget
): JobMediaFileNoteDoc[] {
  return sortMediaNotesChronologically(
    all.filter((n) => mediaNoteMatchesFile(n as unknown as Record<string, unknown>, target))
  );
}

/** Mapa fileId → poznámky (jen podle fileId, bez folder — pro legacy). */
export function groupMediaNotesByFileId(
  notes: JobMediaFileNoteDoc[]
): Map<string, JobMediaFileNoteDoc[]> {
  const m = new Map<string, JobMediaFileNoteDoc[]>();
  for (const n of notes) {
    const ids = mediaNoteLinkedFileIds(n as unknown as Record<string, unknown>);
    for (const id of ids) {
      const prev = m.get(id) ?? [];
      if (!prev.some((x) => x.id === n.id)) prev.push(n);
      m.set(id, prev);
    }
  }
  for (const [k, list] of m) {
    m.set(k, sortMediaNotesChronologically(list));
  }
  return m;
}

export function buildCustomerMediaNotePayload(params: {
  companyId: string;
  jobId: string;
  target: JobMediaFileNoteTarget;
  text: string;
  authorId: string;
  authorName: string;
  source?: JobMediaNoteSource;
}): Omit<JobMediaFileNoteDoc, "id" | "createdAt"> & { createdAt: unknown } {
  const fileId = String(params.target.fileId).trim();
  const folderId = params.target.folderId != null ? String(params.target.folderId).trim() : "";
  const authorFields = buildMessageAuthorPersistFields({
    userId: params.authorId,
    authorName: params.authorName.trim() || "Zákazník",
    authorRole: "customer",
  });
  return {
    companyId: params.companyId,
    jobId: params.jobId,
    fileId,
    mediaId: fileId,
    imageId: fileId,
    documentId: fileId,
    targetId: fileId,
    ...(folderId ? { folderId } : { folderId: null }),
    authorType: "customer",
    ...authorFields,
    text: params.text.trim(),
    visibleToCustomer: true,
    source: params.source ?? "customerPortal",
    updatedAt: null,
    createdAt: null,
  };
}

export function buildStaffMediaNotePayload(params: {
  companyId: string;
  jobId: string;
  target: JobMediaFileNoteTarget;
  text: string;
  authorId: string;
  authorName: string;
  authorType: "admin" | "employee";
  visibleToCustomer: boolean;
}): Omit<JobMediaFileNoteDoc, "id" | "createdAt"> & { createdAt: unknown } {
  const fileId = String(params.target.fileId).trim();
  const folderId = params.target.folderId != null ? String(params.target.folderId).trim() : "";
  const authorFields = buildMessageAuthorPersistFields({
    userId: params.authorId,
    authorName: params.authorName.trim() || "—",
    authorRole: params.authorType,
  });
  return {
    companyId: params.companyId,
    jobId: params.jobId,
    fileId,
    mediaId: fileId,
    imageId: fileId,
    documentId: fileId,
    targetId: fileId,
    ...(folderId ? { folderId } : { folderId: null }),
    authorType: params.authorType,
    ...authorFields,
    text: params.text.trim(),
    visibleToCustomer: params.visibleToCustomer,
    source: params.authorType === "employee" ? "employee" : "admin",
    updatedAt: null,
    createdAt: null,
  };
}

/** Legacy: customerComment na souboru (schválení) → poznámka v historii, pokud chybí v media_notes. */
export function fileCustomerCommentToMediaNoteLike(
  row: Record<string, unknown> | null | undefined,
  target: JobMediaFileNoteTarget
): JobMediaFileNoteDoc | null {
  if (!row) return null;
  const text = String(row.customerComment ?? "").trim();
  if (!text) return null;
  const fileId = String(target.fileId ?? "").trim();
  if (!fileId) return null;
  const folderId = target.folderId != null ? String(target.folderId).trim() : "";
  const authorId = String(row.customerCommentBy ?? "").trim();
  return {
    id: `legacy-approval-comment-${fileId}-${folderId || "root"}`,
    companyId: String(row.companyId ?? row.organizationId ?? ""),
    jobId: String(row.jobId ?? ""),
    fileId,
    mediaId: fileId,
    imageId: fileId,
    documentId: fileId,
    targetId: fileId,
    folderId: folderId || null,
    authorType: "customer",
    authorId: authorId || "customer",
    authorName: "Zákazník",
    text,
    visibleToCustomer: true,
    source: "approval",
    createdAt: row.customerCommentAt ?? row.updatedAt ?? null,
  };
}

export function mergeFileMediaNotesWithLegacyApprovalComment(
  notes: JobMediaFileNoteDoc[],
  row: Record<string, unknown> | null | undefined,
  target: JobMediaFileNoteTarget
): JobMediaFileNoteDoc[] {
  const legacy = fileCustomerCommentToMediaNoteLike(row, target);
  if (!legacy) return notes;
  const normalized = legacy.text.trim().toLowerCase();
  if (notes.some((n) => n.text.trim().toLowerCase() === normalized)) return notes;
  return sortMediaNotesChronologically([...notes, legacy]);
}

/** Legacy: komentář u souboru (jobs/.../comments) → poznámka pro export / zobrazení. */
export function commentRowToMediaNoteLike(
  row: Record<string, unknown> & { id: string }
): JobMediaFileNoteDoc | null {
  const msg = String(row.message ?? "").trim();
  if (!msg) return null;
  const fileId = String(row.fileId ?? "").trim();
  if (!fileId) return null;
  const role = String(row.authorRole ?? "").toLowerCase();
  const authorType: JobMediaNoteAuthorType = role === "customer" ? "customer" : role === "employee" ? "employee" : "admin";
  const visibleToCustomer =
    row.visibleToCustomer === true ||
    row.visibleToCustomer === "true" ||
    authorType === "customer";
  return {
    id: `legacy-comment-${row.id}`,
    companyId: String(row.organizationId ?? ""),
    jobId: String(row.jobId ?? ""),
    fileId,
    mediaId: fileId,
    folderId: row.folderId != null ? String(row.folderId) : null,
    authorType,
    authorId: String(row.authorId ?? row.createdBy ?? ""),
    authorName:
      String(row.authorName ?? row.createdByName ?? "—").trim() || "—",
    text: msg,
    visibleToCustomer,
    source: "legacy",
    createdAt: row.createdAt ?? row.updatedAt ?? null,
  };
}
