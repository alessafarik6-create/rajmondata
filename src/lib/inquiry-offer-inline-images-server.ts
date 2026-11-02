/**
 * Server — stažení příloh a sestavení inline galerie pro odeslání / náhled e-mailu.
 */

import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import { resolveInquiryOfferAttachmentsForEmail } from "@/lib/inquiry-offer-attachment-resolve";
import type { InquiryOfferAttachmentRef } from "@/lib/inquiry-offer-attachments";
import {
  buildInlineImageSlots,
  buildInquiryOfferInlineGalleryHtml,
  listFileAttachmentRefs,
} from "@/lib/inquiry-offer-inline-images";

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
    emailAttachments.push({
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
      contentDisposition: "attachment",
    });
  }

  const resolvedSizeByRefId: Record<string, number> = {};
  for (const [id, file] of byId.entries()) {
    resolvedSizeByRefId[id] = file.content.length;
  }

  return { inlineGalleryHtml, emailAttachments, resolvedSizeByRefId };
}
