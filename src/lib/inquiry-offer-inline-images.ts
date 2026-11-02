/**
 * Inline obrázky v e-mailových nabídkách (CID + HTML galerie).
 */

import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import {
  isInquiryOfferImageAttachment,
  isInquiryOfferInlineInEmail,
  shouldAttachAsFile,
  type InquiryOfferAttachmentRef,
} from "@/lib/inquiry-offer-attachments";
import { resolveInquiryOfferAttachmentsForEmail } from "@/lib/inquiry-offer-attachment-resolve";

export type InquiryOfferInlineImageSlot = {
  ref: InquiryOfferAttachmentRef;
  cid: string;
  alt: string;
  caption: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInlineImageCid(ref: InquiryOfferAttachmentRef, index: number): string {
  const safe = ref.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  return safe ? `nabidka-foto-${index + 1}-${safe}` : `nabidka-foto-${index + 1}`;
}

export function listInlineImageRefs(refs: InquiryOfferAttachmentRef[]): InquiryOfferAttachmentRef[] {
  const inline = refs.filter(isInquiryOfferInlineInEmail);
  return [...inline].sort((a, b) => {
    const oa = a.inlineOrder ?? Number.MAX_SAFE_INTEGER;
    const ob = b.inlineOrder ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return refs.indexOf(a) - refs.indexOf(b);
  });
}

export function listFileAttachmentRefs(refs: InquiryOfferAttachmentRef[]): InquiryOfferAttachmentRef[] {
  return refs.filter(shouldAttachAsFile);
}

export function buildInquiryOfferInlineGalleryHtml(
  images: Array<{ src: string; alt: string; caption?: string | null }>
): string {
  if (images.length === 0) return "";
  const parts: string[] = [];
  for (const img of images) {
    const caption = img.caption?.trim();
    if (caption) {
      parts.push(
        `<p style="margin:16px 0 6px;font-size:14px;font-weight:600;color:#334155;">${escapeHtml(caption)}</p>`
      );
    }
    parts.push(
      `<img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;margin:8px 0 16px;border-radius:8px;" />`
    );
  }
  return parts.join("");
}

export function buildInlineImageSlots(refs: InquiryOfferAttachmentRef[]): InquiryOfferInlineImageSlot[] {
  const inlineRefs = listInlineImageRefs(refs);
  return inlineRefs.map((ref, index) => ({
    ref,
    cid: buildInlineImageCid(ref, index),
    alt: ref.inlineCaption?.trim() || ref.filename.trim() || "Fotografie",
    caption: ref.inlineCaption?.trim() || null,
  }));
}

function bufferToDataUrl(content: Buffer, contentType: string | undefined): string {
  const mime = contentType?.split(";")[0]?.trim() || "image/jpeg";
  return `data:${mime};base64,${content.toString("base64")}`;
}

export async function prepareInquiryOfferEmailImages(params: {
  attachmentRefs: InquiryOfferAttachmentRef[];
  /** V náhledu v prohlížeči CID nefunguje — použij data URL. */
  previewMode?: boolean;
}): Promise<{
  inlineGalleryHtml: string;
  emailAttachments: SendTransactionalEmailAttachment[];
  resolvedSizeByRefId: Record<string, number>;
}> {
  const refs = params.attachmentRefs ?? [];
  const inlineSlots = buildInlineImageSlots(refs);
  const fileRefs = listFileAttachmentRefs(refs);

  const idsToLoad = new Set<string>();
  for (const slot of inlineSlots) idsToLoad.add(slot.ref.id);
  for (const ref of fileRefs) idsToLoad.add(ref.id);

  const toDownload = refs.filter((r) => idsToLoad.has(r.id));
  const downloaded = await resolveInquiryOfferAttachmentsForEmail(toDownload);
  const byId = new Map<string, SendTransactionalEmailAttachment>();
  toDownload.forEach((ref, i) => {
    const file = downloaded[i];
    if (file) byId.set(ref.id, file);
  });

  const galleryImages = inlineSlots.map((slot) => {
    const file = byId.get(slot.ref.id);
    const src = params.previewMode
      ? file
        ? bufferToDataUrl(file.content, file.contentType)
        : ""
      : `cid:${slot.cid}`;
    return { src, alt: slot.alt, caption: slot.caption };
  });

  const inlineGalleryHtml = buildInquiryOfferInlineGalleryHtml(
    galleryImages.filter((g) => g.src)
  );

  const emailAttachments: SendTransactionalEmailAttachment[] = [];

  for (const slot of inlineSlots) {
    const file = byId.get(slot.ref.id);
    if (!file) continue;
    emailAttachments.push({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
      cid: slot.cid,
      contentDisposition: "inline",
    });
  }

  for (const ref of fileRefs) {
    const file = byId.get(ref.id);
    if (!file) continue;
    const alreadyInline = inlineSlots.some((s) => s.ref.id === ref.id);
    emailAttachments.push({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
      contentDisposition: "attachment",
      ...(alreadyInline ? {} : {}),
    });
  }

  const resolvedSizeByRefId: Record<string, number> = {};
  for (const [id, file] of byId.entries()) {
    resolvedSizeByRefId[id] = file.content.length;
  }

  return { inlineGalleryHtml, emailAttachments, resolvedSizeByRefId };
}
