import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";
import type { ProductionWorksheetDrawingRef } from "@/lib/production-worksheet-pdf";

export type ProductionA4MaterialRow = {
  itemName: string;
  quantity: string;
  unit: string;
  cuts?: string;
  remainder?: string;
  note?: string;
  statusLabel?: string;
};

export type BuildProductionA4WorkListPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawing: ProductionWorksheetDrawingRef | null;
  materialRows: ProductionA4MaterialRow[];
  footerNote?: string;
  fontBasePath?: string;
};

async function loadPdfJsWorker() {
  const pdfjs = await import("pdfjs-dist");
  const { configurePdfJsWorker } = await import("@/lib/pdfjs-worker");
  configurePdfJsWorker(pdfjs);
  return pdfjs;
}

async function firstPageThumbDataUrl(drawing: ProductionWorksheetDrawingRef): Promise<string | null> {
  const { url, kind, fileName } = drawing;
  const u = String(url || "").trim();
  if (!u) return null;
  if (kind === "image") {
    try {
      return await fetchImageAsDataUrl(u);
    } catch {
      return null;
    }
  }
  try {
    const pdfjs = await loadPdfJsWorker();
    let pdf: import("pdfjs-dist").PDFDocumentProxy;
    try {
      const task = pdfjs.getDocument({ url: u, withCredentials: false, disableRange: true, disableStream: true });
      pdf = await task.promise;
    } catch {
      const res = await fetch(u, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableRange: true, disableStream: true });
      pdf = await task.promise;
    }
    if (pdf.numPages < 1) {
      try {
        pdf.destroy?.();
      } catch {
        /* */
      }
      return null;
    }
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const maxW = 400;
    const maxH = 560;
    const scale = Math.min(maxW / base.width, maxH / base.height, 2);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      try {
        pdf.destroy?.();
      } catch {
        /* */
      }
      return null;
    }
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    try {
      pdf.destroy?.();
    } catch {
      /* */
    }
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * A4 na šířku — jedna stránka (pokud se tabulka nevejde, autoTable přidá stránky).
 * Čeština přes DejaVu.
 */
export async function buildProductionA4WorkListPdf(opts: BuildProductionA4WorkListPdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  let y = margin;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(14);
  doc.text("Výrobní list — výdej", margin, y);
  y += 7;

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.text(`Zakázka: ${opts.jobName}`, margin, y);
  y += 4.5;
  doc.text(`Zákazník: ${opts.customerLabel || "—"}`, margin, y);
  y += 4.5;
  doc.text(`Datum: ${opts.dateLabel}`, margin, y);
  y += 6;

  const thumbW = 95;
  const thumbH = pageH - y - margin - 28;
  let tableStartX = margin + thumbW + 6;
  let tableStartY = margin + 22;

  if (opts.drawing) {
    const dataUrl = await firstPageThumbDataUrl(opts.drawing);
    if (dataUrl) {
      try {
        const fmt: "JPEG" | "PNG" = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        const props = doc.getImageProperties(dataUrl);
        const iw = props.width;
        const ih = props.height;
        if (iw > 1 && ih > 1) {
          let w = thumbW;
          let h = (ih * w) / iw;
          if (h > thumbH) {
            h = thumbH;
            w = (iw * h) / ih;
          }
          doc.addImage(dataUrl, fmt, margin, y, w, h);
        }
      } catch {
        doc.setFontSize(8);
        doc.text(`Náhled výkresu: ${opts.drawing.fileName}`, margin, y + 4);
      }
      doc.setFont(PDF_FONT_FAMILY, "normal");
      doc.setFontSize(7);
      doc.setTextColor(70, 70, 70);
      const cap = doc.splitTextToSize(String(opts.drawing.fileName || ""), thumbW);
      doc.text(cap, margin, Math.min(y + thumbH - 2, pageH - margin - 14));
      doc.setTextColor(0, 0, 0);
    } else {
      doc.setFontSize(8);
      doc.text(`Výkres: ${opts.drawing.fileName}`, margin, y + 4);
    }
  } else {
    doc.setFontSize(8);
    doc.text("Bez přiloženého výkresu", margin, y + 4);
  }

  const body = opts.materialRows.map((r) => [
    r.itemName,
    r.quantity,
    r.unit,
    r.cuts ?? "—",
    r.remainder ?? "—",
    r.note ?? "",
    r.statusLabel ?? "—",
  ]);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: tableStartX, right: margin, top: tableStartY },
    tableWidth: pageW - tableStartX - margin,
    head: [["Položka", "Množ.", "j.", "Řezy / opak.", "Zbytek / sklad", "Pozn.", "Stav"]],
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: 7,
      cellPadding: 1,
      overflow: "linebreak",
    },
    headStyles: { font: PDF_FONT_FAMILY, fontStyle: "bold", fillColor: [41, 98, 120], textColor: 255 },
    bodyStyles: { font: PDF_FONT_FAMILY },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + thumbH;
  let footY = Math.max(finalY + 6, pageH - margin - 18);
  if (opts.footerNote) {
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(opts.footerNote, pageW - 2 * margin);
    doc.text(lines, margin, footY);
    footY += lines.length * 3.6 + 4;
  }
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8);
  doc.text("Kontrola / podpis: ________________________________", margin, Math.min(footY, pageH - margin));

  return doc;
}

export function downloadProductionA4WorkListPdf(doc: jsPDF, jobName: string, dateLabel: string): void {
  const safe = jobName.replace(/[^\w\-]+/g, "_").slice(0, 36);
  const fn = `vyrobni-list-A4-${safe}-${dateLabel.replace(/\./g, "-").replace(/[:\s]/g, "_")}.pdf`;
  doc.save(fn);
}

export function openProductionA4WorkListPdfPrint(doc: jsPDF): void {
  const blob = doc.output("blob");
  const u = URL.createObjectURL(blob);
  const w = window.open(u, "_blank", "noopener,noreferrer");
  if (w) {
    w.onload = () => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* */
      }
    };
  }
}
