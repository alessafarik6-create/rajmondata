/**
 * Přílohy k odeslání dokumentů ze zakázky — typy a sestavení seznamu v UI (bez serverových závislostí).
 */

import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";
import type { WorkContractLike } from "@/lib/job-billing-invoices";

export const JOB_DOC_EMAIL_ATTACHMENT_LOAD_ERROR =
  "Přílohu se nepodařilo načíst. Zkontrolujte soubor nebo ji odeberte z výběru.";

export const MAX_JOB_DOC_EMAIL_EXTRA_ATTACHMENTS = 15;

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

export function buildWorkContractAttachmentOptions(
  contracts: WorkContractLike[]
): JobDocumentEmailAttachmentOption[] {
  const out: JobDocumentEmailAttachmentOption[] = [];
  for (const c of contracts) {
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    const role = String(c.documentRole ?? "").trim();
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
