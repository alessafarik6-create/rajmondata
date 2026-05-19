/**
 * Přílohy k odeslání dokumentů ze zakázky e-mailem — výběr v UI a načtení na serveru.
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { getDocumentPdfBuffer } from "@/lib/document-email-pdf-server";
import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";
import type { WorkContractLike } from "@/lib/job-billing-invoices";

export const JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR =
  "Přílohu se nepodařilo načíst. Zkontrolujte soubor nebo ji odeberte z výběru.";

export const MAX_JOB_DOC_EMAIL_EXTRA_ATTACHMENTS = 15;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export type JobDocumentEmailAttachmentKind =
  | "work_contract_pdf"
  | "company_document"
  | "production_sheet";

export type JobDocumentEmailAttachmentSourceLabel =
  | "Smlouva"
  | "Příloha ke smlouvě"
  | "Dodatek"
  | "Dokument zakázky"
  | "Výrobní podklad"
  | "Fotodokumentace";

export type JobDocumentEmailAttachmentOption = {
  id: string;
  kind: JobDocumentEmailAttachmentKind;
  sourceId: string;
  filename: string;
  fileType: string;
  sizeBytes: number | null;
  sourceLabel: JobDocumentEmailAttachmentSourceLabel;
  storagePath?: string | null;
  downloadUrl?: string | null;
};

export type JobDocumentEmailAttachmentRef = {
  id: string;
  kind: JobDocumentEmailAttachmentKind;
  sourceId: string;
  filename: string;
  sourceLabel: JobDocumentEmailAttachmentSourceLabel;
};

export function formatAttachmentSizeBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function workContractSourceLabel(role: string | null | undefined): JobDocumentEmailAttachmentSourceLabel {
  const r = String(role ?? "").trim();
  if (r === "addendum") return "Dodatek";
  if (r === "attachment") return "Příloha ke smlouvě";
  return "Smlouva";
}

function workContractTitle(c: Record<string, unknown> & { id: string }): string {
  const t = String(c.documentTitle ?? c.title ?? "").trim();
  if (t) return t;
  const num = String(c.contractNumber ?? "").trim();
  if (num) return `Smlouva ${num}`;
  return "Smlouva o dílo";
}

export function buildWorkContractAttachmentOptions(
  contracts: WorkContractLike[]
): JobDocumentEmailAttachmentOption[] {
  const out: JobDocumentEmailAttachmentOption[] = [];
  for (const c of contracts) {
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    const row = c as WorkContractLike & Record<string, unknown>;
    const role = String(c.documentRole ?? "").trim();
    const title = workContractTitle(row as Record<string, unknown> & { id: string });
    const num = String(c.contractNumber ?? "").trim();
    const safeNum = num.replace(/[^\w.\-]+/g, "_").slice(0, 60);
    const filename = safeNum
      ? `smlouva-${safeNum}.pdf`
      : `smlouva-${id.slice(0, 8)}.pdf`;
    out.push({
      id: `wc-${id}`,
      kind: "work_contract_pdf",
      sourceId: id,
      filename,
      fileType: "application/pdf",
      sizeBytes: null,
      sourceLabel: workContractSourceLabel(role),
      storagePath: null,
      downloadUrl: null,
    });
  }
  return out;
}

export type JobCompanyDocumentRow = {
  id: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  storagePath?: string | null;
  fileUrl?: string | null;
  source?: string | null;
  jobLinkedKind?: string | null;
};

export function buildCompanyDocumentAttachmentOptions(
  docs: JobCompanyDocumentRow[]
): JobDocumentEmailAttachmentOption[] {
  const out: JobDocumentEmailAttachmentOption[] = [];
  for (const d of docs) {
    const id = String(d.id ?? "").trim();
    const storagePath = String(d.storagePath ?? "").trim();
    const fileUrl = String(d.fileUrl ?? "").trim();
    if (!id || (!storagePath && !fileUrl)) continue;
    const filename =
      String(d.fileName ?? "").trim() ||
      storagePath.split("/").pop() ||
      "dokument";
    const source = String(d.source ?? "").trim();
    const kind = String(d.jobLinkedKind ?? "").trim();
    let sourceLabel: JobDocumentEmailAttachmentSourceLabel = "Dokument zakázky";
    if (source === JOB_MEDIA_DOCUMENT_SOURCE || kind === "folderImage" || kind === "legacyPhoto") {
      sourceLabel = "Fotodokumentace";
    }
    const mime = String(d.mimeType ?? "").trim();
    const fileType = mime || guessMimeFromFilename(filename);
    out.push({
      id: `doc-${id}`,
      kind: "company_document",
      sourceId: id,
      filename,
      fileType,
      sizeBytes: d.sizeBytes ?? null,
      sourceLabel,
      storagePath: storagePath || null,
      downloadUrl: fileUrl || null,
    });
  }
  return out;
}

export type ProductionSheetRow = {
  id: string;
  fileName?: string | null;
  fileUrl?: string | null;
  storagePath?: string | null;
  sizeBytes?: number | null;
};

export function buildProductionSheetAttachmentOptions(
  sheets: ProductionSheetRow[]
): JobDocumentEmailAttachmentOption[] {
  const out: JobDocumentEmailAttachmentOption[] = [];
  for (const s of sheets) {
    const id = String(s.id ?? "").trim();
    const storagePath = String(s.storagePath ?? "").trim();
    const fileUrl = String(s.fileUrl ?? "").trim();
    if (!id || (!storagePath && !fileUrl)) continue;
    const filename =
      String(s.fileName ?? "").trim() ||
      storagePath.split("/").pop() ||
      "vyrobni-podklad.pdf";
    out.push({
      id: `ps-${id}`,
      kind: "production_sheet",
      sourceId: id,
      filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
      fileType: "application/pdf",
      sizeBytes: s.sizeBytes ?? null,
      sourceLabel: "Výrobní podklad",
      storagePath: storagePath || null,
      downloadUrl: fileUrl || null,
    });
  }
  return out;
}

function guessMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

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

export function attachmentRefsFromOptions(
  options: JobDocumentEmailAttachmentOption[],
  selectedIds: Set<string>
): JobDocumentEmailAttachmentRef[] {
  return options
    .filter((o) => selectedIds.has(o.id))
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      sourceId: o.sourceId,
      filename: o.filename,
      sourceLabel: o.sourceLabel,
    }));
}
