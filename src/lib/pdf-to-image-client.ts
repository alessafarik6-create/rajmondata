/**
 * Převod stránek PDF na PNG v prohlížeči (pdf.js) — bez serverového canvas balíčku.
 */

export async function loadPdfJsForRasterExport() {
  const pdfjs = await import("pdfjs-dist");
  const ver = pdfjs.version || "4.10.38";
  const major = Number(String(ver).split(".")[0] || "4");
  pdfjs.GlobalWorkerOptions.workerSrc =
    major === 3
      ? "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      : `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

export async function getPdfPageCountFromUrl(url: string): Promise<number> {
  const pdfjs = await loadPdfJsForRasterExport();
  const buf = await fetch(url, { mode: "cors" }).then((r) => {
    if (!r.ok) throw new Error(`PDF nelze načíst (${r.status})`);
    return r.arrayBuffer();
  });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy?.();
  }
}

/**
 * Vykreslí vybrané stránky (1-based) do PNG blobů. Jedno načtení dokumentu.
 */
export async function renderPdfPagesToPngBlobs(
  url: string,
  pageNumbers1Based: number[],
  scale = 2
): Promise<Blob[]> {
  const pdfjs = await loadPdfJsForRasterExport();
  const buf = await fetch(url, { mode: "cors" }).then((r) => {
    if (!r.ok) throw new Error(`PDF nelze načíst (${r.status})`);
    return r.arrayBuffer();
  });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: Blob[] = [];
  try {
    const pages = [...new Set(pageNumbers1Based)]
      .map((p) => Math.max(1, Math.floor(p)))
      .filter((p) => p <= pdf.numPages);
    for (const p of pages) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale });
      const w = Math.max(1, Math.ceil(viewport.width));
      const h = Math.max(1, Math.ceil(viewport.height));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D není k dispozici.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob selhalo"))),
          "image/png",
          0.92
        );
      });
      out.push(blob);
    }
    return out;
  } finally {
    await pdf.destroy?.();
  }
}
