/**
 * Server — stažení příloh nabídky pro SMTP / Resend.
 */

import { getAdminStorageBucket } from "@/lib/firebase-admin";
import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import {
  INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR,
  type InquiryOfferAttachmentRef,
} from "@/lib/inquiry-offer-attachments";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

async function downloadFromStoragePath(
  storagePath: string,
  filename: string,
  contentType: string | null
): Promise<SendTransactionalEmailAttachment> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error(INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR);
  try {
    const [buf] = await bucket.file(storagePath).download();
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Příloha „${filename}“ je příliš velká (max 12 MB).`);
    }
    return {
      filename,
      content: buf,
      contentType: contentType ?? undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("příliš velká")) throw err;
    throw new Error(INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR);
  }
}

async function downloadFromUrl(
  url: string,
  filename: string,
  contentType: string | null
): Promise<SendTransactionalEmailAttachment> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Příloha „${filename}“ je příliš velká (max 12 MB).`);
    }
    const ct = contentType || res.headers.get("content-type") || undefined;
    return {
      filename,
      content: buf,
      contentType: ct ?? undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("příliš velká")) throw err;
    throw new Error(INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR);
  }
}

export async function resolveInquiryOfferAttachmentsForEmail(
  refs: InquiryOfferAttachmentRef[]
): Promise<SendTransactionalEmailAttachment[]> {
  const list = refs.slice(0, MAX_ATTACHMENTS);
  if (list.length === 0) return [];

  const out: SendTransactionalEmailAttachment[] = [];
  for (const ref of list) {
    const filename = ref.filename.trim() || "priloha";
    const path = ref.storagePath?.trim();
    const url = ref.downloadUrl?.trim();
    if (!path && !url) {
      throw new Error(INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR);
    }
    if (path) {
      out.push(await downloadFromStoragePath(path, filename, ref.contentType ?? null));
    } else if (url) {
      out.push(await downloadFromUrl(url, filename, ref.contentType ?? null));
    }
  }

  if (out.length !== list.length) {
    throw new Error(INQUIRY_OFFER_ATTACHMENT_LOAD_ERROR);
  }
  return out;
}

/** Metadata příloh pro historii (velikost po stažení). */
export function mergeAttachmentRefsWithResolvedSizes(
  refs: InquiryOfferAttachmentRef[],
  resolved: SendTransactionalEmailAttachment[]
): InquiryOfferAttachmentRef[] {
  return refs.map((ref, i) => ({
    ...ref,
    sizeBytes: resolved[i]?.content.length ?? ref.sizeBytes ?? null,
  }));
}
