/**
 * Inline obrázky v e-mailových nabídkách — sdílené utility (bez serverových závislostí).
 */

import {
  isInquiryOfferInlineInEmail,
  shouldAttachAsFile,
  type InquiryOfferAttachmentRef,
} from "@/lib/inquiry-offer-attachments";

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
