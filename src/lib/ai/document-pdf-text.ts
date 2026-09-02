/**
 * Extrakce textu z PDF (server-only, pdfjs-dist).
 */

export async function extractPdfTextContent(buffer: Buffer): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    const parts: string[] = [];
    const maxPages = Math.min(pdf.numPages, 3);
    for (let i = 1; i <= maxPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          return String((item as { str?: string }).str ?? "");
        })
        .join(" ");
      if (text.trim()) parts.push(text.trim());
    }
    return parts.join("\n\n").trim();
  } catch (err) {
    console.error("[extractPdfTextContent]", err instanceof Error ? err.message : err);
    return "";
  }
}
