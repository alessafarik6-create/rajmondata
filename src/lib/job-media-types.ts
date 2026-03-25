/**
 * Fotky ve složkách zakázky + fotodokumentace (legacy photos kolekce).
 */

export type JobMediaFirestorePath =
  | { kind: "photos" }
  | { kind: "folderImages"; folderId: string };

/** Rozšíření záznamu fotky pro editor anotací (Firestore cíl updateDoc). */
export type JobPhotoAnnotationTarget = {
  id: string;
  imageUrl?: string;
  originalImageUrl?: string;
  annotatedImageUrl?: string;
  storagePath?: string;
  annotatedStoragePath?: string;
  path?: string;
  fullPath?: string;
  url?: string;
  downloadURL?: string;
  fileName?: string;
  name?: string;
  annotationData?: unknown;
  annotationsJson?: string;
  /** Cíl zápisu anotací a načtení annotationData */
  annotationTarget: JobMediaFirestorePath;
};

export type JobFolderDoc = {
  id: string;
  name?: string;
  companyId?: string;
  jobId?: string;
  createdAt?: unknown;
  createdBy?: string;
};

export type JobFolderImageDoc = {
  id: string;
  fileName?: string;
  name?: string;
  imageUrl?: string;
  url?: string;
  downloadURL?: string;
  originalImageUrl?: string;
  storagePath?: string;
  path?: string;
  companyId?: string;
  jobId?: string;
  folderId?: string;
  createdAt?: unknown;
  createdBy?: string;
  annotatedImageUrl?: string;
  annotatedStoragePath?: string;
  annotationData?: unknown;
  note?: string;
  noteUpdatedAt?: unknown;
  noteUpdatedBy?: string;
};

export const JOB_IMAGE_ACCEPT_ATTR =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export function getJobMediaPreviewUrl(row: {
  annotatedImageUrl?: string;
  imageUrl?: string;
  url?: string;
  downloadURL?: string;
}): string {
  const candidates = [
    row.annotatedImageUrl,
    row.imageUrl,
    row.url,
    row.downloadURL,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/** Formát data pro náhled v mřížce. */
export function formatMediaDate(t: unknown): string {
  try {
    if (!t) return "—";
    if (typeof (t as { toDate?: () => Date }).toDate === "function") {
      return (t as { toDate: () => Date }).toDate().toLocaleString("cs-CZ");
    }
    if (typeof t === "number") {
      return new Date(t).toLocaleString("cs-CZ");
    }
    return "—";
  } catch {
    return "—";
  }
}

export function isAllowedJobImageFile(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t === "image/jpeg" || t === "image/png" || t === "image/webp")
    return true;
  const n = file.name.toLowerCase();
  return (
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".png") ||
    n.endsWith(".webp")
  );
}
