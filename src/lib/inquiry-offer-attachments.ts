/**
 * Přílohy k e-mailovým nabídkám — knihovna, výběr, metadata.
 */

export const INQUIRY_OFFER_LIBRARY_COLLECTION = "inquiry_offer_library";

export type InquiryOfferAttachmentSource =
  | "library"
  | "upload"
  | "catalog"
  | "inventory";

export const INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR =
  "Přílohu se nepodařilo načíst. Zkontrolujte soubor nebo ji odeberte.";

export const INQUIRY_ATTACHMENT_SOURCE_LABELS: Record<InquiryOfferAttachmentSource, string> = {
  library: "Knihovna příloh",
  upload: "Nahráno v nabídce",
  catalog: "Produktový katalog",
  inventory: "Sklad",
};

export function formatAttachmentSizeBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type InquiryOfferAttachmentRef = {
  id: string;
  source: InquiryOfferAttachmentSource;
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  storagePath?: string | null;
  downloadUrl?: string | null;
  /** ID v knihovně / katalogu / skladu */
  sourceId?: string | null;
  label?: string | null;
  /** Obrázek zobrazený v těle e-mailu (výchozí u obrázků). */
  inlineInEmail?: boolean;
  /** Popisek pod / nad fotografií v e-mailu. */
  inlineCaption?: string | null;
  /** Pořadí fotografií v galerii e-mailu. */
  inlineOrder?: number;
  /** Kromě inline zobrazení i jako běžná příloha ke stažení. */
  alsoAsAttachment?: boolean;
};

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i;

export function isInquiryOfferImageAttachment(ref: InquiryOfferAttachmentRef): boolean {
  const ct = String(ref.contentType ?? "")
    .trim()
    .toLowerCase();
  if (ct.startsWith("image/")) return true;
  return IMAGE_EXT.test(ref.filename.trim());
}

export function isInquiryOfferInlineInEmail(ref: InquiryOfferAttachmentRef): boolean {
  if (!isInquiryOfferImageAttachment(ref)) return false;
  return ref.inlineInEmail !== false;
}

/** Soubor jde jako MIME příloha (PDF, DOCX, nebo obrázek jen jako příloha). */
export function shouldAttachAsFile(ref: InquiryOfferAttachmentRef): boolean {
  if (!isInquiryOfferImageAttachment(ref)) return true;
  if (!isInquiryOfferInlineInEmail(ref)) return true;
  if (ref.alsoAsAttachment === true) return true;
  return false;
}

export function nextInlineOrder(attachments: InquiryOfferAttachmentRef[]): number {
  let max = 0;
  for (const a of attachments) {
    if (typeof a.inlineOrder === "number" && Number.isFinite(a.inlineOrder)) {
      max = Math.max(max, a.inlineOrder);
    }
  }
  return max + 1;
}

export function prepareInquiryOfferAttachmentForAdd(
  ref: InquiryOfferAttachmentRef,
  existing: InquiryOfferAttachmentRef[]
): InquiryOfferAttachmentRef {
  if (!isInquiryOfferImageAttachment(ref)) {
    return { ...ref, inlineInEmail: false };
  }
  return {
    ...ref,
    inlineInEmail: ref.inlineInEmail !== false,
    inlineOrder: ref.inlineOrder ?? nextInlineOrder(existing),
    alsoAsAttachment: ref.alsoAsAttachment === true,
  };
}

export type InquiryOfferLibraryItem = {
  id?: string;
  companyId?: string;
  name: string;
  category?: string | null;
  active: boolean;
  storagePath: string;
  downloadUrl: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  sortOrder?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function parseInquiryOfferLibraryDoc(
  id: string,
  data: Record<string, unknown>
): InquiryOfferLibraryItem {
  return {
    id,
    companyId: data.companyId != null ? String(data.companyId) : undefined,
    name: String(data.name ?? "").trim() || "Příloha",
    category: data.category != null ? String(data.category).trim() || null : null,
    active: data.active !== false,
    storagePath: String(data.storagePath ?? "").trim(),
    downloadUrl: String(data.downloadUrl ?? "").trim(),
    contentType: data.contentType != null ? String(data.contentType) : null,
    sizeBytes: Number.isFinite(Number(data.sizeBytes)) ? Number(data.sizeBytes) : null,
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function attachmentRefKey(a: InquiryOfferAttachmentRef): string {
  return `${a.source}:${a.id}:${a.storagePath ?? a.downloadUrl ?? a.filename}`;
}

export function parseAttachmentRefs(raw: unknown): InquiryOfferAttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: InquiryOfferAttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const filename = String(o.filename ?? "").trim();
    const source = String(o.source ?? "").trim() as InquiryOfferAttachmentSource;
    if (!id || !filename) continue;
    if (!["library", "upload", "catalog", "inventory"].includes(source)) continue;
    const contentType = o.contentType != null ? String(o.contentType) : null;
    const inlineInEmail =
      o.inlineInEmail === false ? false : o.inlineInEmail === true ? true : undefined;
    out.push({
      id,
      source,
      filename,
      contentType,
      sizeBytes: Number.isFinite(Number(o.sizeBytes)) ? Number(o.sizeBytes) : null,
      storagePath: o.storagePath != null ? String(o.storagePath).trim() || null : null,
      downloadUrl: o.downloadUrl != null ? String(o.downloadUrl).trim() || null : null,
      sourceId: o.sourceId != null ? String(o.sourceId).trim() || null : null,
      label: o.label != null ? String(o.label).trim() || null : null,
      inlineInEmail,
      inlineCaption: o.inlineCaption != null ? String(o.inlineCaption).trim() || null : null,
      inlineOrder: Number.isFinite(Number(o.inlineOrder)) ? Number(o.inlineOrder) : undefined,
      alsoAsAttachment: o.alsoAsAttachment === true,
    });
  }
  return out;
}
