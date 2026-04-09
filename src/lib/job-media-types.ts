/**
 * Fotky ve složkách zakázky + fotodokumentace (legacy photos kolekce).
 */

export type JobMediaFirestorePath =
  | { kind: "photos" }
  | { kind: "folderImages"; folderId: string }
  /** Foto zaměření — companies/{companyId}/measurement_photos/{id} */
  | { kind: "measurementPhotos" };

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
  /** Pro kind === measurementPhotos — stejné jako id dokumentu v measurement_photos */
  measurementPhotoId?: string;
  /** Nové foto z foťáku — upload až po uložení v editoru (id začíná na `pending-`). */
  pendingLocalFile?: File;
  /** Object URL pro uvolnění při zrušení editoru */
  pendingObjectUrl?: string;
  /** Metadata z dialogu před přechodem do editoru (IndexedDB). */
  pendingMeasurementTitle?: string | null;
  pendingMeasurementNote?: string | null;
  pendingMeasurementRecordId?: string | null;
};

/** Typ vlastní složky u zakázky (v Firestore pole `type`). */
export type JobFolderType = "photos" | "documents" | "files";

export type JobFolderEmployeeVisibility = "internal_only" | "employee_visible";

export type JobFolderDoc = {
  id: string;
  name?: string;
  /** Fotodokumentace / doklady / obecné soubory */
  type?: JobFolderType;
  companyId?: string;
  jobId?: string;
  createdAt?: unknown;
  createdBy?: string;
  /** Bez explicitního true je složka interní (zaměstnanec nevidí). */
  employeeVisible?: boolean;
  /** Synonymum pro budoucí rozšíření (pravidla Firestore akceptují i employee_visible). */
  employeeVisibility?: JobFolderEmployeeVisibility;
  /** Povolit nahrávání zaměstnanci s omezeným přístupem. */
  employeeUploadAllowed?: boolean;
  /** Klientský portál — výslovně povolit zobrazení zákazníkovi (jinak interní). */
  customerVisible?: boolean;
  /** Klientský portál — zákazník může anotovat / komentovat. */
  customerAnnotatable?: boolean;
  /** Pouze interní (firma), zákazník nevidí. */
  internalOnly?: boolean;
};

export type JobMediaFileType = "image" | "pdf" | "office";

export type JobFolderImageDoc = {
  id: string;
  fileName?: string;
  name?: string;
  imageUrl?: string;
  url?: string;
  downloadURL?: string;
  originalImageUrl?: string;
  /** explicitně uložený typ; bez něj se odvodí z přípony / legacy záznamy = image */
  fileType?: JobMediaFileType;
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
  /** Účetní vazba u složky „Doklady“ */
  ledgerKind?: "income" | "expense";
  ledgerExpenseId?: string;
  ledgerFinanceId?: string | null;
  ledgerAmountNet?: number;
  ledgerAmountGross?: number;
  ledgerDate?: string;
  /** Viditelnost souboru pro zaměstnance (přepíše výchozí dědění ze složky). */
  employeeVisible?: boolean;
  /** Audit nahrání zaměstnancem (Firestore pravidla). */
  uploadSource?: string;
  uploadedBy?: string;
  uploadedByEmployeeId?: string;
  uploadedAt?: unknown;
  /** Klientský portál — výslovně viditelné zákazníkovi. */
  customerVisible?: boolean;
  customerAnnotatable?: boolean;
  internalOnly?: boolean;
  /** Schválení konkrétního souboru zákazníkem (klientský portál). */
  requiresCustomerApproval?: boolean;
  approvalStatus?: "pending" | "approved" | "changes_requested";
  approvalNoteFromAdmin?: string | null;
  approvalRequestedAt?: unknown;
  approvalRequestedBy?: string | null;
  approvedAt?: unknown;
  approvedBy?: string | null;
  customerComment?: string | null;
  customerCommentAt?: unknown;
  customerCommentBy?: string | null;
};

/** Výběr z galerie / souborů: obrázky i PDF. */
export const JOB_MEDIA_ACCEPT_ATTR = "image/*,application/pdf";

/** Pouze obrázky (fotoaparát / Vyfotit). */
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

const OFFICE_MIME_PREFIXES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
];

function isOfficeFileName(name: string): boolean {
  return /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(name);
}

export function isAllowedJobOfficeFile(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (OFFICE_MIME_PREFIXES.some((p) => t.startsWith(p))) return true;
  return isOfficeFileName(file.name);
}

export function isAllowedJobMediaFile(file: File): boolean {
  if (isAllowedJobImageFile(file)) return true;
  const t = (file.type || "").toLowerCase();
  if (t === "application/pdf") return true;
  if (file.name.toLowerCase().endsWith(".pdf")) return true;
  return isAllowedJobOfficeFile(file);
}

export function getJobMediaFileTypeFromFile(file: File): JobMediaFileType {
  if (isAllowedJobImageFile(file)) return "image";
  if (isAllowedJobOfficeFile(file)) return "office";
  return "pdf";
}

/** Typ položky v UI / mazání – z DB nebo z názvu souboru. */
export function inferJobMediaItemType(row: {
  fileType?: string | null;
  fileName?: string | null;
  name?: string | null;
}): JobMediaFileType {
  if (row.fileType === "pdf") return "pdf";
  if (row.fileType === "image") return "image";
  if (row.fileType === "office") return "office";
  const base = String(row.fileName || row.name || "").toLowerCase();
  if (base.endsWith(".pdf")) return "pdf";
  if (isOfficeFileName(base)) return "office";
  return "image";
}
