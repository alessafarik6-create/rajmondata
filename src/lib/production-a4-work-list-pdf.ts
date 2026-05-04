import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";
import {
  loadPdfDocumentFromUrl,
  renderPdfJsPageToJsPdfRegion,
  type ProductionWorksheetDrawingRef,
} from "@/lib/production-worksheet-pdf";
import type { ProductionA4MaterialRow } from "@/lib/production-a4-material-rows";

export type { ProductionA4MaterialRow } from "@/lib/production-a4-material-rows";

/** „Přehled“ = menší násobič / JPEG; „Tisk“ = vyšší rozlišení, PNG výkresu, větší tabulka. */
export type ProductionA4ExportVariant = "overview" | "print";

export type ProductionA4HeaderBranding = {
  organizationName: string;
  organizationLogoUrl?: string | null;
  /** Adresa organizace (1–2 řádky) */
  organizationAddress?: string;
  /** Adresa zakázky / montáže */
  jobAddress?: string;
};

export type BuildProductionA4WorkListPdfOptions = {
  jobName: string;
  customerLabel: string;
  dateLabel: string;
  /** Logo, firma, adresa dodavatele */
  organization?: ProductionA4HeaderBranding | null;
  drawing: ProductionWorksheetDrawingRef | null;
  materialRows: ProductionA4MaterialRow[];
  footerNote?: string;
  fontBasePath?: string;
  variant?: ProductionA4ExportVariant;
};

const DRAW_MARGIN_MM = 5;

function formatAddressOneLine(s: string | undefined): string {
  const t = String(s || "")
    .trim()
    .replace(/\s+/g, " ");
  return t;
}

/**
 * Hlavička: 1) logo + organizace, 2) zakázka, 3) zákazník / datum / adresa
 * Vrátí Y pod hlavičkou.
 */
function drawBrandedHeader(
  doc: jsPDF,
  margin: number,
  contentW: number,
  opts: BuildProductionA4WorkListPdfOptions,
  logoDataUrl: string | null
): number {
  let y = margin;
  const orgName = String(opts.organization?.organizationName || "").trim() || "Organizace";
  const orgAddr = formatAddressOneLine(opts.organization?.organizationAddress);
  const jobAddr = formatAddressOneLine(opts.organization?.jobAddress);

  let logoBottom = y;
  if (logoDataUrl) {
    try {
      const maxH = 12;
      const maxW = 22;
      const prop = doc.getImageProperties(logoDataUrl);
      const iw = Math.max(1, prop.width);
      const ih = Math.max(1, prop.height);
      let w = maxW;
      let h = (ih * w) / iw;
      if (h > maxH) {
        h = maxH;
        w = (iw * h) / ih;
      }
      const fmt: "PNG" | "JPEG" = logoDataUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmt, margin, y, w, h);
      logoBottom = y + h;
    } catch {
      /* */
    }
  }
  const textX = logoDataUrl ? margin + 24 : margin;
  const textW = contentW - (textX - margin);

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 30, 40);
  const orgLines = doc.splitTextToSize(orgName, textW);
  const orgStartY = y + 4;
  doc.text(orgLines, textX, orgStartY);
  y = Math.max(logoBottom, orgStartY + orgLines.length * 4.3) + 2;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  const jobLines = doc.splitTextToSize(String(opts.jobName), contentW);
  doc.text(jobLines, margin, y);
  y += jobLines.length * 4.3 + 2;

  const line3Parts = [
    `Zákazník: ${opts.customerLabel || "—"}`,
    `Datum: ${opts.dateLabel}`,
    jobAddr ? `Adresa: ${jobAddr}` : "",
  ].filter(Boolean);
  let line3 = line3Parts.join("  ·  ");
  if (orgAddr) {
    line3 = `${line3}\nProvoz / firma: ${orgAddr}`;
  }
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(45, 55, 65);
  const l3 = doc.splitTextToSize(line3, contentW);
  doc.text(l3, margin, y);
  y += l3.length * 3.5 + 2;
  doc.setTextColor(0, 0, 0);
  return y;
}

function variantRenderOpts(variant: ProductionA4ExportVariant): {
  resolutionScale: number;
  imageFormat: "png" | "jpeg";
  jpegQuality: number;
  tableFont: number;
  tableHeadFont: number;
  cellPadding: number;
} {
  if (variant === "print") {
    return {
      resolutionScale: 3,
      imageFormat: "png",
      jpegQuality: 0.95,
      tableFont: 8.5,
      tableHeadFont: 8.5,
      cellPadding: 1.2,
    };
  }
  return {
    resolutionScale: 2.5,
    imageFormat: "jpeg",
    jpegQuality: 0.95,
    tableFont: 7.5,
    tableHeadFont: 7.5,
    cellPadding: 1,
  };
}

/**
 * Vloží rastr výkresu přes canvas ve zvýšeném rozlišení (ne nízký náhled).
 */
async function embedRasterImageHighRes(
  doc: jsPDF,
  url: string,
  region: { x: number; y: number; maxW: number; maxH: number },
  variant: ProductionA4ExportVariant
): Promise<void> {
  const dataUrl = await fetchImageAsDataUrl(url);
  if (!dataUrl) return;

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const nw = Math.max(1, img.naturalWidth || img.width);
        const nh = Math.max(1, img.naturalHeight || img.height);
        const scaleMul = variant === "print" ? 3 : 2.5;
        const targetW = Math.min(10000, Math.floor(nw * scaleMul));
        const targetH = Math.floor((nh / nw) * targetW);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, targetW);
        canvas.height = Math.max(1, targetH);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve();
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out =
          variant === "print"
            ? canvas.toDataURL("image/png")
            : canvas.toDataURL("image/jpeg", 0.95);
        const fmt: "PNG" | "JPEG" = variant === "print" ? "PNG" : "JPEG";
        const { x, y, maxW, maxH } = region;
        const imgProps = doc.getImageProperties(out);
        const iw = imgProps.width;
        const ih = imgProps.height;
        if (iw < 1 || ih < 1) {
          resolve();
          return;
        }
        let w = maxW;
        let h = (ih * w) / iw;
        if (h > maxH) {
          h = maxH;
          w = (iw * h) / ih;
        }
        const px = x + (maxW - w) / 2;
        const py = y + (maxH - h) / 2;
        doc.addImage(out, fmt, px, py, w, h);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("image-load"));
    img.src = dataUrl;
  });
}

function pageOrientFromPdfViewport(vp: { width: number; height: number }): "portrait" | "landscape" {
  return vp.width >= vp.height ? "landscape" : "portrait";
}

function addMaterialTable(
  doc: jsPDF,
  opts: BuildProductionA4WorkListPdfOptions,
  margin: number,
  startY: number,
  ro: ReturnType<typeof variantRenderOpts>
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const body = opts.materialRows.map((r) => r.cells);

  const head = [
    [
      "Materiál",
      "Výdej",
      "Zbytek po řezu",
      "Zbývá ks",
      "Plné ks",
      "Načaté ks",
      "Celkem zbývá (mm)",
      "Zbytky",
      "Doporučení",
    ],
  ];

  autoTable(doc, {
    startY,
    margin: { left: margin, right: margin },
    head,
    body,
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: ro.tableFont,
      cellPadding: ro.cellPadding,
      overflow: "linebreak",
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fontSize: ro.tableHeadFont,
      fillColor: [41, 98, 120],
      textColor: 255,
    },
    bodyStyles: { font: PDF_FONT_FAMILY, fontSize: ro.tableFont },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = opts.materialRows[data.row.index];
      if (!row) return;
      if (row.highlightUseScrap) {
        data.cell.styles.fillColor = [255, 237, 213];
        data.cell.styles.textColor = [120, 53, 15];
      }
      if (row.boldRemainder && data.column.index === 2) {
        data.cell.styles.fontStyle = "bold";
        if (!row.highlightUseScrap) data.cell.styles.textColor = [15, 118, 110];
      }
      if (row.boldLineTotal && data.column.index === 6) {
        data.cell.styles.fontStyle = "bold";
        if (!row.highlightUseScrap) data.cell.styles.textColor = [15, 118, 110];
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? startY + 40;
  let footY = Math.min(finalY + 5, pageH - margin - 12);
  if (opts.footerNote) {
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(70, 70, 70);
    const lines = doc.splitTextToSize(opts.footerNote, pageW - 2 * margin);
    doc.text(lines, margin, footY);
    footY += lines.length * 3.4 + 3;
    doc.setTextColor(0, 0, 0);
  }
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8);
  doc.text("Kontrola / podpis: ________________________________", margin, Math.min(footY, pageH - margin));
}

/**
 * Výrobní list: výkres(y) podle orientace stránky PDF, tabulka materiálu (kompaktní, bez zbytečných mezer).
 */
export async function buildProductionA4WorkListPdf(opts: BuildProductionA4WorkListPdfOptions): Promise<jsPDF> {
  const variant: ProductionA4ExportVariant = opts.variant ?? "overview";
  const ro = variantRenderOpts(variant);

  let logoDataUrl: string | null = null;
  const logoUrl = String(opts.organization?.organizationLogoUrl || "").trim();
  if (logoUrl) {
    try {
      logoDataUrl = await fetchImageAsDataUrl(logoUrl);
    } catch {
      logoDataUrl = null;
    }
  }

  const drawing = opts.drawing;
  const u = drawing ? String(drawing.url || "").trim() : "";

  if (!drawing || !u) {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");
    const margin = 10;
    const pageW = doc.internal.pageSize.getWidth();
    const afterY = drawBrandedHeader(doc, margin, pageW - 2 * margin, opts, logoDataUrl);
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(10);
    doc.text("Materiál — řezy a zbytky", margin, afterY + 2);
    addMaterialTable(doc, opts, margin, afterY + 8, ro);
    return doc;
  }

  let doc: jsPDF | null = null;

  if (drawing.kind === "pdf") {
    let pdf: import("pdfjs-dist").PDFDocumentProxy | null = null;
    try {
      pdf = await loadPdfDocumentFromUrl(u);
      const n = pdf.numPages;
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const orient = pageOrientFromPdfViewport(vp1);
        if (i === 1) {
          doc = new jsPDF({ unit: "mm", format: "a4", orientation: orient });
          await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");
          const lw = doc.internal.pageSize.getWidth();
          const lh = doc.internal.pageSize.getHeight();
          const headerEnd = drawBrandedHeader(doc, DRAW_MARGIN_MM, lw - 2 * DRAW_MARGIN_MM, opts, logoDataUrl);
          const maxW = lw - 2 * DRAW_MARGIN_MM;
          const maxH = lh - headerEnd - DRAW_MARGIN_MM;
          await renderPdfJsPageToJsPdfRegion(doc, page, {
            x: DRAW_MARGIN_MM,
            y: headerEnd,
            maxW,
            maxH,
            resolutionScale: ro.resolutionScale,
            imageFormat: ro.imageFormat,
            jpegQuality: ro.jpegQuality,
          });
        } else {
          const vp = page.getViewport({ scale: 1 });
          const o = pageOrientFromPdfViewport(vp);
          doc!.addPage("a4", o);
          const lw = doc!.internal.pageSize.getWidth();
          const lh = doc!.internal.pageSize.getHeight();
          const maxW = lw - 2 * DRAW_MARGIN_MM;
          const maxH = lh - 2 * DRAW_MARGIN_MM;
          await renderPdfJsPageToJsPdfRegion(doc!, page, {
            x: DRAW_MARGIN_MM,
            y: DRAW_MARGIN_MM,
            maxW,
            maxH,
            resolutionScale: ro.resolutionScale,
            imageFormat: ro.imageFormat,
            jpegQuality: ro.jpegQuality,
          });
        }
      }
    } finally {
      try {
        pdf?.destroy?.();
      } catch {
        /* */
      }
    }
  } else if (drawing.kind === "image") {
    const dataUrl = await fetchImageAsDataUrl(u);
    let orient: "portrait" | "landscape" = "landscape";
    if (dataUrl) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const nw = Math.max(1, img.naturalWidth || img.width);
          const nh = Math.max(1, img.naturalHeight || img.height);
          orient = nw >= nh ? "landscape" : "portrait";
          resolve();
        };
        img.onerror = () => resolve();
        img.src = dataUrl;
      });
    }
    doc = new jsPDF({ unit: "mm", format: "a4", orientation: orient });
    await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");
    let lw = doc.internal.pageSize.getWidth();
    let lh = doc.internal.pageSize.getHeight();
    const headerEnd = drawBrandedHeader(doc, DRAW_MARGIN_MM, lw - 2 * DRAW_MARGIN_MM, opts, logoDataUrl);
    const maxW = lw - 2 * DRAW_MARGIN_MM;
    const maxH = lh - headerEnd - DRAW_MARGIN_MM;
    try {
      await embedRasterImageHighRes(doc, u, { x: DRAW_MARGIN_MM, y: headerEnd, maxW, maxH }, variant);
    } catch {
      doc.setFont(PDF_FONT_FAMILY, "normal");
      doc.setFontSize(10);
      doc.text(`Obrázek výkresu se nepodařilo načíst: ${drawing.fileName}`, DRAW_MARGIN_MM, headerEnd + 4);
    }
  }

  if (!doc) {
    doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");
  }

  doc.addPage("a4", "portrait");
  const margin = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const headerBottom = drawBrandedHeader(doc, margin, pageW - 2 * margin, opts, logoDataUrl);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(10);
  doc.text("Materiál — řezy a zbytky", margin, headerBottom + 2);
  addMaterialTable(doc, opts, margin, headerBottom + 8, ro);

  return doc;
}

export function downloadProductionA4WorkListPdf(
  doc: jsPDF,
  jobName: string,
  dateLabel: string,
  variant: ProductionA4ExportVariant = "overview"
): void {
  const safe = jobName.replace(/[^\w\-]+/g, "_").slice(0, 32);
  const part = variant === "print" ? "tisk" : "prehled";
  const fn = `vyrobni-list-A4-${part}-${safe}-${dateLabel.replace(/\./g, "-").replace(/[:\s]/g, "_")}.pdf`;
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
