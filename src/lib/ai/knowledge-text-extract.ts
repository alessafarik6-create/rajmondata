/**
 * Extrakce textu pro znalostní bázi — PDF po stránkách + fallback OCR.
 */

import { extractPdfPagesContent } from "@/lib/ai/document-pdf-text";
import type { Firestore } from "firebase-admin/firestore";
import { analyzeCompanyDocument } from "@/lib/ai/document-extraction-service";

export type KnowledgePageText = {
  pageNumber: number | null;
  text: string;
  hasVisualContent: boolean;
};

export type KnowledgeExtractResult =
  | {
      ok: true;
      pages: KnowledgePageText[];
      source: "pdf_text" | "document_ai" | "plain";
      pageCount: number;
    }
  | { ok: false; error: string };

function splitPlainIntoPseudoPages(text: string): KnowledgePageText[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/\n{2,}/).filter(Boolean);
  if (parts.length <= 1) {
    return [{ pageNumber: 1, text: normalized, hasVisualContent: false }];
  }
  return parts.map((part, i) => ({
    pageNumber: i + 1,
    text: part.trim(),
    hasVisualContent: false,
  }));
}

export async function extractKnowledgeDocumentPages(
  db: Firestore,
  companyId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<KnowledgeExtractResult> {
  const mime = mimeType.toLowerCase();

  if (mime.includes("pdf")) {
    const pdfPages = await extractPdfPagesContent(fileBuffer);
    const totalText = pdfPages.map((p) => p.text).join(" ").trim();

    if (totalText.length >= 40) {
      return {
        ok: true,
        pages: pdfPages.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.text,
          hasVisualContent: p.hasVisualContent,
        })),
        source: "pdf_text",
        pageCount: pdfPages.length,
      };
    }

    console.info("[knowledge-text] PDF_TEXT_EXTRACTION_FALLBACK_TO_DOCUMENT_AI", {
      fileName,
      directLength: totalText.length,
    });

    const analysis = await analyzeCompanyDocument({
      db,
      companyId,
      fileBuffer,
      mimeType,
      fileName,
    });
    if (!analysis.ok) {
      return {
        ok: false,
        error:
          totalText.length > 0
            ? "PDF obsahuje málo textu a AI OCR selhalo."
            : "PDF neobsahuje textovou vrstvu a OCR selhalo.",
      };
    }
    const text = analysis.searchableText.trim();
    if (text.length < 20) {
      return { ok: false, error: "PDF se nepodařilo převést na prohledávatelný text." };
    }
    const pages = splitPlainIntoPseudoPages(text);
    return {
      ok: true,
      pages: pages.map((p) => ({ ...p, hasVisualContent: true })),
      source: "document_ai",
      pageCount: pages.length,
    };
  }

  if (mime.includes("text") || mime.includes("plain")) {
    const text = fileBuffer.toString("utf8").trim();
    if (!text) return { ok: false, error: "Textový soubor je prázdný." };
    const pages = splitPlainIntoPseudoPages(text);
    return { ok: true, pages, source: "plain", pageCount: pages.length };
  }

  const text = fileBuffer.toString("utf8").trim();
  if (text.length >= 20) {
    const pages = splitPlainIntoPseudoPages(text);
    return { ok: true, pages, source: "plain", pageCount: pages.length };
  }
  return { ok: false, error: "Nepodporovaný nebo prázdný formát souboru." };
}

/** @deprecated Use extractKnowledgeDocumentPages */
export async function extractKnowledgeDocumentText(
  db: Firestore,
  companyId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ ok: true; text: string; source: "pdf_text" | "document_ai" | "plain" } | { ok: false; error: string }> {
  const res = await extractKnowledgeDocumentPages(db, companyId, fileBuffer, mimeType, fileName);
  if (!res.ok) return res;
  const text = res.pages.map((p) => p.text).filter(Boolean).join("\n\n").trim();
  return { ok: true, text, source: res.source };
}
