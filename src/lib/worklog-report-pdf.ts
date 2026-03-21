/**
 * Export přehledu výkazu práce do PDF (UTF-8 přes vykreslení HTML → canvas).
 */
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export function buildWorklogPdfFileName(prefix: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const safe = prefix.replace(/[^\w\u00C0-\u024f\s-]+/g, "").trim().replace(/\s+/g, "_");
  return `${safe || "vykaz"}_${y}-${mo}-${day}.pdf`;
}

/**
 * Vygeneruje PDF z DOM uzlu (např. skrytého nebo viditelného přehledu k tisku).
 */
export async function downloadWorklogPdfFromElement(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(fileName);
}
