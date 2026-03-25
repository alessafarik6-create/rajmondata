/**
 * Jednotný Firestore záznam dokladu: companies/{companyId}/documents/{docId}
 * Pro média zakázky (složky + legacy fotodokumentace) — ID je deterministické,
 * bez duplicity vedle jobs/.../photos nebo folders/.../images.
 */

import type { Firestore } from "firebase/firestore";
import { doc, serverTimestamp } from "firebase/firestore";
import {
  getJobMediaPreviewUrl,
  inferJobMediaItemType,
  type JobMediaFileType,
} from "@/lib/job-media-types";

export const JOB_MEDIA_DOCUMENT_SOURCE = "job-media" as const;

export type JobLinkedKind = "folderImage" | "legacyPhoto";

export function companyDocumentIdForJobFolderImage(
  folderId: string,
  imageId: string
): string {
  return `jobFld_${folderId}_${imageId}`;
}

export function companyDocumentIdForJobLegacyPhoto(photoId: string): string {
  return `jobPhoto_${photoId}`;
}

export function companyDocumentRefForJobFolderImage(
  firestore: Firestore,
  companyId: string,
  folderId: string,
  imageId: string
) {
  return doc(
    firestore,
    "companies",
    companyId,
    "documents",
    companyDocumentIdForJobFolderImage(folderId, imageId)
  );
}

export function companyDocumentRefForJobLegacyPhoto(
  firestore: Firestore,
  companyId: string,
  photoId: string
) {
  return doc(
    firestore,
    "companies",
    companyId,
    "documents",
    companyDocumentIdForJobLegacyPhoto(photoId)
  );
}

function fileUrlForMirror(row: {
  annotatedImageUrl?: string;
  imageUrl?: string;
  url?: string;
  downloadURL?: string;
}): string {
  return getJobMediaPreviewUrl(row);
}

function todayIsoDate(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function buildNewJobFolderImageMirrorDocument(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  folderId: string;
  imageId: string;
  userId: string;
  fileName: string;
  fileType: JobMediaFileType;
  mimeType?: string | null;
  fileUrl: string;
  storagePath: string | null;
  note: string | null;
  dateIso?: string;
}): Record<string, unknown> {
  const note = params.note?.trim() ? params.note.trim() : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const fn = params.fileName.trim() || "soubor";
  const ts = serverTimestamp();
  return {
    type: "received",
    documentKind: "prijate",
    source: JOB_MEDIA_DOCUMENT_SOURCE,
    sourceType: "job",
    sourceId: params.imageId,
    jobLinkedKind: "folderImage" as JobLinkedKind,
    folderId: params.folderId,
    jobId: params.jobId,
    jobName: jn || null,
    number: fn.slice(0, 120),
    entityName: jn || "Zakázka",
    description: note ?? fn,
    note,
    date: params.dateIso ?? todayIsoDate(),
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    mimeType: params.mimeType?.trim() || null,
    fileName: fn,
    storagePath: params.storagePath,
    vat: 0,
    organizationId: params.companyId,
    createdBy: params.userId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function buildJobFolderImageMirrorMergePatchFromRow(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  folderId: string;
  row: {
    id: string;
    fileName?: string;
    name?: string;
    note?: string | null;
    fileType?: string | null;
    storagePath?: string | null;
    path?: string | null;
    annotatedImageUrl?: string;
    imageUrl?: string;
    url?: string;
    downloadURL?: string;
  };
}): Record<string, unknown> {
  const note =
    typeof params.row.note === "string" && params.row.note.trim()
      ? params.row.note.trim()
      : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const fn =
    (params.row.fileName || params.row.name || params.row.id).trim() ||
    "soubor";
  const fileUrl = fileUrlForMirror(params.row);
  const ft = inferJobMediaItemType(params.row);
  const sp =
    (typeof params.row.storagePath === "string" && params.row.storagePath) ||
    (typeof params.row.path === "string" && params.row.path) ||
    null;
  return {
    type: "received",
    documentKind: "prijate",
    source: JOB_MEDIA_DOCUMENT_SOURCE,
    sourceType: "job",
    sourceId: params.row.id,
    jobLinkedKind: "folderImage" as JobLinkedKind,
    folderId: params.folderId,
    jobId: params.jobId,
    jobName: jn || null,
    number: fn.slice(0, 120),
    entityName: jn || "Zakázka",
    description: note ?? fn,
    note,
    fileUrl: fileUrl || null,
    fileType: ft,
    fileName: fn,
    storagePath: sp,
    organizationId: params.companyId,
    updatedAt: serverTimestamp(),
  };
}

export function buildNewJobLegacyPhotoMirrorDocument(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  photoId: string;
  userId: string;
  fileName: string;
  fileType: JobMediaFileType;
  mimeType?: string | null;
  fileUrl: string;
  storagePath: string | null;
  note: string | null;
  dateIso?: string;
}): Record<string, unknown> {
  const note = params.note?.trim() ? params.note.trim() : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const fn = params.fileName.trim() || "soubor";
  const ts = serverTimestamp();
  return {
    type: "received",
    documentKind: "prijate",
    source: JOB_MEDIA_DOCUMENT_SOURCE,
    sourceType: "job",
    sourceId: params.photoId,
    jobLinkedKind: "legacyPhoto" as JobLinkedKind,
    jobId: params.jobId,
    jobName: jn || null,
    number: fn.slice(0, 120),
    entityName: jn || "Zakázka",
    description: note ?? fn,
    note,
    date: params.dateIso ?? todayIsoDate(),
    fileUrl: params.fileUrl,
    fileType: params.fileType,
    mimeType: params.mimeType?.trim() || null,
    fileName: fn,
    storagePath: params.storagePath,
    vat: 0,
    organizationId: params.companyId,
    createdBy: params.userId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Po uložení anotovaného náhledu (nové fileUrl, typ zůstává obrázek). */
export function buildJobMediaMirrorAnnotatedUrlPatch(params: {
  fileUrl: string;
  jobDisplayName: string | null;
}): Record<string, unknown> {
  const jn = params.jobDisplayName?.trim() ?? "";
  return {
    fileUrl: params.fileUrl,
    fileType: "image" as JobMediaFileType,
    jobName: jn || null,
    updatedAt: serverTimestamp(),
  };
}

/** Aktualizace jen textové poznámky v globálním dokladu (bez čtení celého řádku z UI). */
export function buildJobMediaMirrorNoteOnlyPatch(params: {
  note: string | null;
  fileNameFallback: string;
  jobDisplayName: string | null;
}): Record<string, unknown> {
  const note =
    typeof params.note === "string" && params.note.trim()
      ? params.note.trim()
      : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const fb = params.fileNameFallback.trim() || "soubor";
  return {
    note,
    description: note ?? fb,
    jobName: jn || null,
    updatedAt: serverTimestamp(),
  };
}

export function buildJobLegacyPhotoMirrorMergePatchFromRow(params: {
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  row: {
    id: string;
    fileName?: string;
    name?: string;
    note?: string | null;
    fileType?: string | null;
    storagePath?: string | null;
    path?: string | null;
    annotatedImageUrl?: string;
    imageUrl?: string;
    url?: string;
    downloadURL?: string;
  };
}): Record<string, unknown> {
  const note =
    typeof params.row.note === "string" && params.row.note.trim()
      ? params.row.note.trim()
      : null;
  const jn = params.jobDisplayName?.trim() ?? "";
  const fn =
    (params.row.fileName || params.row.name || params.row.id).trim() ||
    "soubor";
  const fileUrl = fileUrlForMirror(params.row);
  const ft = inferJobMediaItemType(params.row);
  const sp =
    (typeof params.row.storagePath === "string" && params.row.storagePath) ||
    (typeof params.row.path === "string" && params.row.path) ||
    null;
  return {
    type: "received",
    documentKind: "prijate",
    source: JOB_MEDIA_DOCUMENT_SOURCE,
    sourceType: "job",
    sourceId: params.row.id,
    jobLinkedKind: "legacyPhoto" as JobLinkedKind,
    jobId: params.jobId,
    jobName: jn || null,
    number: fn.slice(0, 120),
    entityName: jn || "Zakázka",
    description: note ?? fn,
    note,
    fileUrl: fileUrl || null,
    fileType: ft,
    fileName: fn,
    storagePath: sp,
    organizationId: params.companyId,
    updatedAt: serverTimestamp(),
  };
}
