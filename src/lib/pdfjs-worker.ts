/**
 * Jednotné nastavení workeru pdf.js — lokální soubor z /public (postinstall skript).
 * Nepoužívat unpkg ani jiné CDN.
 */

type PdfJsLike = {
  GlobalWorkerOptions: { workerSrc: string };
};

export function configurePdfJsWorker(pdfjs: PdfJsLike): void {
  if (typeof window === "undefined") return;
  const base = window.location?.origin || "";
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.mjs`;
}
