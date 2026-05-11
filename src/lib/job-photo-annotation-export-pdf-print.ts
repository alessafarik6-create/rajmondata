import { jsPDF } from "jspdf";
import { scaleCanvasMaxSide } from "@/lib/job-photo-annotation-export-composite";

const PDF_CANVAS_MAX_SIDE = 5600;

function safePdfFileName(base: string): string {
  const t = (base || "vykres")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return t || "vykres";
}

/**
 * Jednostránkové PDF: A4 podle poměru stran (landscape / portrait), obrázek + legenda vycentrované.
 */
export function downloadAnnotatedCompositeAsPdf(
  canvas: HTMLCanvasElement,
  filenameBase: string
): void {
  const scaled = scaleCanvasMaxSide(canvas, PDF_CANVAS_MAX_SIDE);
  const marginMm = 10;
  const isLandscape = scaled.width >= scaled.height;
  const doc = new jsPDF({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth() - 2 * marginMm;
  const pageH = doc.internal.pageSize.getHeight() - 2 * marginMm;
  const pxToMm = 25.4 / 96;
  const imgWmm = scaled.width * pxToMm;
  const imgHmm = scaled.height * pxToMm;
  let dw = Math.min(pageW, imgWmm);
  let dh = (scaled.height / scaled.width) * dw;
  if (dh > pageH) {
    dh = pageH;
    dw = (scaled.width / scaled.height) * dh;
  }
  const x = marginMm + (pageW - dw) / 2;
  const y = marginMm + (pageH - dh) / 2;
  const dataUrl = scaled.toDataURL("image/jpeg", 0.94);
  doc.addImage(dataUrl, "JPEG", x, y, dw, dh);
  doc.save(`${safePdfFileName(filenameBase)}-anotace.pdf`);
}

/**
 * Otevře nové okno s náhledem pro tisk (stejný rastr jako export).
 */
export function printAnnotatedCompositeCanvas(
  canvas: HTMLCanvasElement,
  _title: string
): void {
  const scaled = scaleCanvasMaxSide(canvas, PDF_CANVAS_MAX_SIDE);
  const dataUrl = scaled.toDataURL("image/png");
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    throw new Error("Prohlížeč zablokoval nové okno — povolte vyskakovací okna pro tisk.");
  }
  const html = `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><title>Tisk anotací</title>
<style>
  html,body{margin:0;padding:0;background:#fff;}
  @media print {
    @page { margin: 10mm; size: auto; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
</style></head><body>
<img id="annot" src="${dataUrl}" alt="Anotovaný výkres" />
<script>
(function(){
  var img = document.getElementById("annot");
  function doPrint() {
    try { window.focus(); window.print(); } catch (e) {}
  }
  if (img && img.complete) setTimeout(doPrint, 200);
  else if (img) img.onload = function() { setTimeout(doPrint, 200); };
  else setTimeout(doPrint, 300);
})();
<\/script>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
