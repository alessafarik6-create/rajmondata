/**
 * Server — stažení příloh nabídky pro SMTP / Resend.
 */

import { getAdminStorageBucket } from "@/lib/firebase-admin";
import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import type { InquiryOfferAttachmentRef } from "@/lib/inquiry-offer-attachments";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

async function downloadFromStoragePath(
  storagePath: string,
  filename: string,
  contentType: string | null
): Promise<SendTransactionalEmailAttachment> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není dostupný.");
  const [buf] = await bucket.file(storagePath).download();
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Příloha „${filename}“ je příliš velká (max 12 MB).`);
  }
  return {
    filename,
    content: buf,
    contentType: contentType ?? undefined,
  };
}

async function downloadFromUrl(
  url: string,
  filename: string,
  contentType: string | null
): Promise<SendTransactionalEmailAttachment> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Nelze stáhnout přílohu „${filename}“.`);
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
}

export async function resolveInquiryOfferAttachmentsForEmail(
  refs: InquiryOfferAttachmentRef[]
): Promise<SendTransactionalEmailAttachment[]> {
  const list = refs.slice(0, MAX_ATTACHMENTS);
  const out: SendTransactionalEmailAttachment[] = [];
  for (const ref of list) {
    const filename = ref.filename.trim() || "priloha";
    const path = ref.storagePath?.trim();
    const url = ref.downloadUrl?.trim();
    if (path) {
      out.push(await downloadFromStoragePath(path, filename, ref.contentType ?? null));
    } else if (url) {
      out.push(await downloadFromUrl(url, filename, ref.contentType ?? null));
    }
  }
  return out;
}
