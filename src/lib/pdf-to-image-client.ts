/**
 * Převod stránek PDF na PNG v prohlížeči (pdf.js) — bez serverového canvas balíčku.
 */

export async function loadPdfJsForRasterExport() {
  const pdfjs = await import("pdfjs-dist");
  const { configurePdfJsWorker } = await import("@/lib/pdfjs-worker");
  configurePdfJsWorker(pdfjs);
  return pdfjs;
}

async function loadPdfBytesFromUrl(url: string): Promise<Uint8Array> {
  const u = String(url || "").trim();
  if (!u) throw new Error("Chybí URL PDF.");
  if (u.startsWith("blob:")) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`PDF nelze načíst (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const res = await fetch(u, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`PDF nelze načíst (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getPdfPageCountFromData(data: Uint8Array): Promise<number> {
  const pdfjs = await loadPdfJsForRasterExport();
  const pdf = await pdfjs.getDocument({ data, disableRange: true, disableStream: true }).promise;
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy?.();
  }
}

export async function getPdfPageCountFromUrl(url: string): Promise<number> {
  const buf = await loadPdfBytesFromUrl(url);
  return getPdfPageCountFromData(buf);
}

/**
 * Vykreslí vybrané stránky (1-based) do PNG blobů. Jedno načtení dokumentu.
 */
export async function renderPdfPagesToPngBlobsFromData(
  data: Uint8Array,
  pageNumbers1Based: number[],
  scale = 2
): Promise<Blob[]> {
  const pdfjs = await loadPdfJsForRasterExport();
  const pdf = await pdfjs.getDocument({ data, disableRange: true, disableStream: true }).promise;
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

export async function renderPdfPagesToPngBlobs(
  url: string,
  pageNumbers1Based: number[],
  scale = 2
): Promise<Blob[]> {
  const buf = await loadPdfBytesFromUrl(url);
  return renderPdfPagesToPngBlobsFromData(buf, pageNumbers1Based, scale);
}

/** Miniatura první stránky — zachová poměr stran, max. šířka v px. */
export async function renderPdfFirstPageThumbnailFromData(
  data: Uint8Array,
  maxWidthPx = 140
): Promise<Blob> {
  const pdfjs = await loadPdfJsForRasterExport();
  const pdf = await pdfjs.getDocument({ data, disableRange: true, disableStream: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.15, maxWidthPx / Math.max(1, base.width)));
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
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob selhalo"))),
        "image/png",
        0.88
      );
    });
  } finally {
    await pdf.destroy?.();
  }
}
