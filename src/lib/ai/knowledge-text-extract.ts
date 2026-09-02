/**
 * Extrakce textu pro znalostní bázi — PDF text layer + fallback přes existující document AI pipeline.
 */

import { extractPdfTextContent } from "@/lib/ai/document-pdf-text";
import type { Firestore } from "firebase-admin/firestore";
import { analyzeCompanyDocument } from "@/lib/ai/document-extraction-service";

export async function extractKnowledgeDocumentText(
  db: Firestore,
  companyId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ ok: true; text: string; source: "pdf_text" | "document_ai" | "plain" } | { ok: false; error: string }> {
  const mime = mimeType.toLowerCase();

  if (mime.includes("pdf")) {
    const direct = await extractPdfTextContent(fileBuffer);
    if (direct.length >= 40) {
      return { ok: true, text: direct, source: "pdf_text" };
    }

    console.info("[knowledge-text] PDF_TEXT_EXTRACTION_FALLBACK_TO_DOCUMENT_AI", {
      fileName,
      directLength: direct.length,
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
          direct.length > 0
            ? "PDF obsahuje málo textu a AI OCR selhalo."
            : "PDF neobsahuje textovou vrstvu a OCR selhalo.",
      };
    }
    const text = analysis.searchableText.trim();
    if (text.length < 20) {
      return { ok: false, error: "PDF se nepodařilo převést na prohledávatelný text." };
    }
    return { ok: true, text, source: "document_ai" };
  }

  if (mime.includes("text") || mime.includes("plain")) {
    const text = fileBuffer.toString("utf8").trim();
    if (!text) return { ok: false, error: "Textový soubor je prázdný." };
    return { ok: true, text, source: "plain" };
  }

  const text = fileBuffer.toString("utf8").trim();
  if (text.length >= 20) {
    return { ok: true, text, source: "plain" };
  }
  return { ok: false, error: "Nepodporovaný nebo prázdný formát souboru." };
}
