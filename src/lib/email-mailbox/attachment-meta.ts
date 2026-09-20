import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

export const EMAIL_ATTACHMENT_JOB_CATEGORIES = [
  "document",
  "invoice",
  "contract",
  "drawing",
  "photo",
  "order",
  "offer",
  "other",
] as const;

export type EmailAttachmentJobCategory = (typeof EMAIL_ATTACHMENT_JOB_CATEGORIES)[number];

export const EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS: Record<EmailAttachmentJobCategory, string> = {
  document: "Dokument",
  invoice: "Faktura",
  contract: "Smlouva",
  drawing: "Výkres",
  photo: "Fotografie",
  order: "Objednávka",
  offer: "Nabídka",
  other: "Ostatní",
};

export function formatAttachmentSizeBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function attachmentExtension(filename: string): string {
  const m = filename.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1]!.toLowerCase() : "";
}

export function attachmentKindLabel(contentType: string, filename: string): string {
  const ext = attachmentExtension(filename);
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf") || ext === "pdf") return "PDF";
  if (ct.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "Obrázek";
  if (ext === "doc" || ext === "docx" || ct.includes("word")) return "Word";
  if (ext === "xls" || ext === "xlsx" || ct.includes("excel") || ct.includes("spreadsheet")) return "Excel";
  if (ext === "zip" || ct.includes("zip")) return "ZIP";
  return ext.toUpperCase() || "Soubor";
}

export function isPreviewableImage(contentType: string, filename: string): boolean {
  const ct = contentType.toLowerCase();
  const ext = attachmentExtension(filename);
  return (
    ct.startsWith("image/") &&
    ["jpg", "jpeg", "png", "webp", "gif"].includes(ext || ct.split("/")[1] || "")
  );
}

export function isPreviewablePdf(contentType: string, filename: string): boolean {
  return contentType.toLowerCase().includes("pdf") || attachmentExtension(filename) === "pdf";
}

/** Skryté inline prvky podpisu — nejsou „uživatelské“ přílohy. */
export function isLikelySignatureInlineAttachment(input: {
  filename: string;
  contentType: string;
  size: number;
  disposition?: string | null;
  contentId?: string | null;
  related?: boolean;
}): boolean {
  const disp = String(input.disposition ?? "").toLowerCase();
  const ct = input.contentType.toLowerCase();
  const size = input.size;
  const fn = input.filename.trim().toLowerCase();

  if (disp === "attachment") return false;
  if (size > 120_000 && disp !== "inline") return false;

  const isImage = ct.startsWith("image/");
  if (!isImage) return disp === "inline" && size < 8_000;

  if (size > 200_000) return false;
  if (/\.(png|jpe?g|gif|webp)$/.test(fn) && size < 80_000) {
    if (/^(image\d+|logo|signature|podpis|icon|spacer)/.test(fn)) return true;
    if (disp === "inline" && input.contentId) return true;
    if (input.related && disp === "inline") return true;
  }
  if (disp === "inline" && input.contentId && size < 100_000) return true;
  return false;
}

export function userVisibleAttachments(
  attachments: EmailMessageAttachmentMeta[] | null | undefined
): EmailMessageAttachmentMeta[] {
  return (attachments ?? []).filter((a) => a.userVisible !== false && a.hidden !== true);
}

export function attachmentCountForList(
  attachments: EmailMessageAttachmentMeta[] | null | undefined
): number {
  return userVisibleAttachments(attachments).length;
}

export function sanitizeStorageFilename(filename: string): string {
  const base = filename.replace(/[/\\?%*:|"<>]/g, "_").trim() || "priloha";
  return base.slice(0, 180);
}
