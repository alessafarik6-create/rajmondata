import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";

export type ProductionWorksheetConsumptionRow = {
  itemName: string;
  quantity: string;
  unit: string;
  repeatCount?: string;
  note?: string;
  remainingOnStock?: string;
  stockPieceSummary?: string;
  allocations?: string;
  createdBy?: string;
  createdAt?: string;
  bulkGroup?: string;
};

export type ProductionWorksheetDrawingRef = {
  url: string;
  fileName: string;
  kind: "pdf" | "image";
};

export type BuildProductionWorksheetPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  drawingNote?: string;
  rows: ProductionWorksheetConsumptionRow[];
  pendingLines?: string[];
  /** Přiložit aktuální výkres (PDF jako náhled stránek, obrázek jako obrázek). */
  attachDrawing?: boolean;
  drawing?: ProductionWorksheetDrawingRef | null;
  /** Kořen pro /fonts/DejaVu*.ttf */
  fontBasePath?: string;
};

async function loadPdfJsWorker() {
  const pdfjs = await import("pdfjs-dist");
  const ver = pdfjs.version || "4.10.38";
  const major = Number(String(ver).split(".")[0] || "4");
  pdfjs.GlobalWorkerOptions.workerSrc =
    major === 3
      ? "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      : `//unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.min.js`;
  return pdfjs;
}

function addImageDataUrlToPage(doc: jsPDF, dataUrl: string, fmt: "JPEG" | "PNG") {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin;
  const imgProps = doc.getImageProperties(dataUrl);
  const iw = imgProps.width;
  const ih = imgProps.height;
  if (iw < 1 || ih < 1) return;
  let w = maxW;
  let h = (ih * w) / iw;
  if (h > maxH) {
    h = maxH;
    w = (iw * h) / ih;
  }
  const x = margin + (maxW - w) / 2;
  const y = margin + (maxH - h) / 2;
  doc.addImage(dataUrl, fmt, x, y, w, h);
}

async function appendDrawingToDoc(doc: jsPDF, drawing: ProductionWorksheetDrawingRef): Promise<void> {
  const { url, fileName, kind } = drawing;
  const u = String(url || "").trim();
  if (!u) return;

  if (kind === "image") {
    try {
      const dataUrl = await fetchImageAsDataUrl(u);
      if (!dataUrl) throw new Error("fetch");
      const fmt: "JPEG" | "PNG" = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      doc.addPage();
      addImageDataUrlToPage(doc, dataUrl, fmt);
    } catch {
      doc.addPage();
      doc.setFont(PDF_FONT_FAMILY, "normal");
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(
        `Výkres (obrázek) se nepodařilo vložit. Soubor: ${fileName}\nOdkaz: ${u}`,
        doc.internal.pageSize.getWidth() - 20
      );
      doc.text(lines, 14, 20);
    }
    return;
  }

  try {
    const pdfjs = await loadPdfJsWorker();
    let pdf: import("pdfjs-dist").PDFDocumentProxy;
    try {
      const task = pdfjs.getDocument({
        url: u,
        withCredentials: false,
        disableRange: true,
        disableStream: true,
      });
      pdf = await task.promise;
    } catch {
      const res = await fetch(u, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableRange: true, disableStream: true });
      pdf = await task.promise;
    }

    for (let i = 1; i <= pdf.numPages; i++) {
      doc.addPage();
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 8;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;
      const scale = Math.min(maxW / base.width, maxH / base.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      addImageDataUrlToPage(doc, dataUrl, "JPEG");
    }
    try {
      pdf.destroy?.();
    } catch {
      /* */
    }
  } catch {
    doc.addPage();
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(
      `Výkres (PDF) se nepodařilo vložit jako náhled. Soubor: ${fileName}\nOdkaz: ${u}`,
      doc.internal.pageSize.getWidth() - 20
    );
    doc.text(lines, 14, 20);
  }
}

/**
 * Výrobní podklad pro tisk — zakázka, zákazník, datum, tabulka spotřeb.
 * Font DejaVu Sans (UTF-8 / čeština).
 */
export async function buildProductionWorksheetPdf(opts: BuildProductionWorksheetPdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");

  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(16);
  doc.text("Výrobní podklad", 14, y);
  y += 8;

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(10);
  doc.text(`Zakázka: ${opts.jobName}`, 14, y);
  y += 5;
  doc.text(`Zákazník: ${opts.customerLabel || "—"}`, 14, y);
  y += 5;
  doc.text(`Datum: ${opts.dateLabel}`, 14, y);
  y += 6;

  if (opts.drawingNote) {
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(opts.drawingNote, pageW - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 4;
    doc.setTextColor(0, 0, 0);
  }

  if (opts.pendingLines && opts.pendingLines.length > 0) {
    doc.setFontSize(9);
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.text("Připraveno k výdeji (ještě neodebráno)", 14, y);
    y += 5;
    doc.setFont(PDF_FONT_FAMILY, "normal");
    for (const ln of opts.pendingLines.slice(0, 30)) {
      doc.text(`• ${ln}`, 16, y);
      y += 4;
      if (y > 270) {
        doc.addPage();
        y = 14;
      }
    }
    y += 4;
  }

  const tableBody = opts.rows.map((r) => [
    r.itemName,
    r.quantity,
    r.unit,
    r.repeatCount ?? "—",
    r.remainingOnStock ?? "—",
    r.allocations ?? "—",
    r.note ?? "",
    r.createdBy ?? "—",
    r.createdAt ?? "—",
  ]);

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Položka",
        "Množ.",
        "j.",
        "Řezy",
        "Zbývá sklad",
        "Odebráno z kusů",
        "Pozn.",
        "Kdo",
        "Kdy",
      ],
    ],
    body: tableBody,
    styles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
      fontSize: 7,
      cellPadding: 1.2,
      overflow: "linebreak",
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: [41, 98, 120],
      textColor: [255, 255, 255],
    },
    bodyStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "normal",
    },
    margin: { left: 10, right: 10 },
  });

  if (opts.attachDrawing && opts.drawing) {
    await appendDrawingToDoc(doc, opts.drawing);
  }

  return doc;
}

export function downloadProductionWorksheetPdf(doc: jsPDF, jobName: string, dateLabel: string): void {
  const fn = `vyrobni-podklad-${jobName.replace(/[^\w\-]+/g, "_").slice(0, 40)}-${dateLabel.replace(/\./g, "-")}.pdf`;
  doc.save(fn);
}

export function openProductionWorksheetPdfInNewTab(doc: jsPDF): void {
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
