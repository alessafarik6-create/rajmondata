import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { getDocumentPdfBuffer } from "@/lib/document-email-pdf-server";
import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import {
  JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR,
  MAX_JOB_DOC_EMAIL_EXTRA_ATTACHMENTS,
  type JobDocumentEmailAttachmentKind,
  type JobDocumentEmailAttachmentRef,
  type JobDocumentEmailAttachmentSourceLabel,
} from "@/lib/job-document-email-attachments";

export { JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR } from "@/lib/job-document-email-attachments";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export function parseJobDocumentEmailAttachmentRefs(raw: unknown): JobDocumentEmailAttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: JobDocumentEmailAttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const sourceId = String(o.sourceId ?? "").trim();
    const kind = String(o.kind ?? "").trim() as JobDocumentEmailAttachmentKind;
    const filename = String(o.filename ?? "").trim();
    const sourceLabel = String(o.sourceLabel ?? "").trim() as JobDocumentEmailAttachmentSourceLabel;
    if (!id || !sourceId || !filename) continue;
    if (!["work_contract_pdf", "company_document", "production_sheet"].includes(kind)) continue;
    out.push({ id, kind, sourceId, filename, sourceLabel });
  }
  return out.slice(0, MAX_JOB_DOC_EMAIL_EXTRA_ATTACHMENTS);
}

async function downloadFromStorage(
  bucket: NonNullable<Awaited<ReturnType<typeof import("@/lib/firebase-admin").getAdminStorageBucket>>>,
  storagePath: string,
  filename: string,
  contentType: string | null
): Promise<SendTransactionalEmailAttachment> {
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
    throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
  }
}

async function downloadFromUrl(
  url: string,
  filename: string,
  contentType: string | null
): Promise<SendTransactionalEmailAttachment> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Příloha „${filename}“ je příliš velká (max 12 MB).`);
    }
    const ct = contentType || res.headers.get("content-type") || undefined;
    return { filename, content: buf, contentType: ct ?? undefined };
  } catch (err) {
    if (err instanceof Error && err.message.includes("příliš velká")) throw err;
    throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
  }
}

export async function resolveJobDocumentEmailExtraAttachments(
  db: Firestore,
  params: {
    companyId: string;
    jobId: string;
    refs: JobDocumentEmailAttachmentRef[];
  }
): Promise<SendTransactionalEmailAttachment[]> {
  const { getAdminStorageBucket } = await import("@/lib/firebase-admin");
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není dostupný.");

  const list = params.refs.slice(0, MAX_JOB_DOC_EMAIL_EXTRA_ATTACHMENTS);
  const out: SendTransactionalEmailAttachment[] = [];

  for (const ref of list) {
    if (ref.kind === "work_contract_pdf") {
      const pdf = await getDocumentPdfBuffer({
        db,
        companyId: params.companyId,
        jobId: params.jobId,
        type: "contract",
        contractId: ref.sourceId,
        invoiceId: null,
        materialOrderId: null,
      });
      if (!pdf.ok) {
        throw new Error(pdf.error || JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      }
      if (pdf.buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Příloha „${ref.filename}“ je příliš velká (max 12 MB).`);
      }
      out.push({
        filename: ref.filename || pdf.filename,
        content: pdf.buffer,
        contentType: "application/pdf",
      });
      continue;
    }

    if (ref.kind === "company_document") {
      const docSnap = await db
        .collection(COMPANIES_COLLECTION)
        .doc(params.companyId)
        .collection("documents")
        .doc(ref.sourceId)
        .get();
      if (!docSnap.exists) throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      const d = (docSnap.data() ?? {}) as Record<string, unknown>;
      if (!isActiveFirestoreDoc(d)) throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      const jobOnDoc = String(d.jobId ?? "").trim();
      if (jobOnDoc && jobOnDoc !== params.jobId) {
        throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      }
      const storagePath = String(d.storagePath ?? "").trim();
      const fileUrl = String(d.fileUrl ?? d.downloadURL ?? "").trim();
      const mime = String(d.mimeType ?? "").trim() || null;
      const filename =
        ref.filename ||
        String(d.fileName ?? "").trim() ||
        "dokument";
      if (storagePath) {
        out.push(await downloadFromStorage(bucket, storagePath, filename, mime));
      } else if (fileUrl) {
        out.push(await downloadFromUrl(fileUrl, filename, mime));
      } else {
        throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      }
      continue;
    }

    if (ref.kind === "production_sheet") {
      const sheetSnap = await db
        .collection(COMPANIES_COLLECTION)
        .doc(params.companyId)
        .collection("jobs")
        .doc(params.jobId)
        .collection("productionSheets")
        .doc(ref.sourceId)
        .get();
      if (!sheetSnap.exists) throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      const d = (sheetSnap.data() ?? {}) as Record<string, unknown>;
      const storagePath = String(d.storagePath ?? "").trim();
      const fileUrl = String(d.fileUrl ?? "").trim();
      const filename = ref.filename || String(d.fileName ?? "vyrobni-podklad.pdf").trim();
      if (storagePath) {
        out.push(
          await downloadFromStorage(bucket, storagePath, filename, "application/pdf")
        );
      } else if (fileUrl) {
        out.push(await downloadFromUrl(fileUrl, filename, "application/pdf"));
      } else {
        throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
      }
    }
  }

  if (out.length !== list.length) {
    throw new Error(JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR);
  }
  return out;
}
