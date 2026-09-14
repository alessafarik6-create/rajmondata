/**
 * Extrakce textu z PDF po stránkách (server-only, pdfjs-dist).
 */

export type PdfPageContent = {
  pageNumber: number;
  text: string;
  /** Heuristika: málo textu nebo zmínka o obrázku/schématu. */
  hasVisualContent: boolean;
};

function detectVisualContentHeuristic(text: string, textItemCount: number): boolean {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (text.trim().length < 80 && textItemCount < 8) return true;
  if (/\b(obrazek|obrázek|schema|schéma|nakres|nákres|vykres|výkres|detail|tabulka|diagram)\b/.test(t)) {
    return true;
  }
  return false;
}

export async function extractPdfPagesContent(
  buffer: Buffer,
  maxPages = 150
): Promise<PdfPageContent[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    const pages: PdfPageContent[] = [];
    const limit = Math.min(pdf.numPages, maxPages);

    for (let i = 1; i <= limit; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item) => item && typeof item === "object"
      ) as Array<{ str?: string }>;
      const text = items
        .map((item) => String(item.str ?? ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pages.push({
        pageNumber: i,
        text,
        hasVisualContent: detectVisualContentHeuristic(text, items.length),
      });
    }

    return pages;
  } catch (err) {
    console.error("[extractPdfPagesContent]", err instanceof Error ? err.message : err);
    return [];
  }
}

/** @deprecated Prefer extractPdfPagesContent — kept for legacy callers. */
export async function extractPdfTextContent(buffer: Buffer): Promise<string> {
  const pages = await extractPdfPagesContent(buffer, 3);
  return pages
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
