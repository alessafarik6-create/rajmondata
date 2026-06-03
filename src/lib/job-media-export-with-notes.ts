/**
 * Export / tisk souboru zakázky včetně poznámek, vlákna u souboru a schválení.
 */

import { jsPDF } from "jspdf";
import {
  approvalStatusLabelCs,
  parseJobMediaApproval,
  type ParsedJobMediaApproval,
} from "@/lib/job-media-customer-approval";
import {
  defaultHexForDimensionColor,
  deserializeJobPhotoAnnotations,
  readAnnotationPayloadFromPhotoDoc,
  type JobPhotoAnnotation,
} from "@/lib/job-photo-annotations";
import {
  buildAnnotatedCompositeCanvas,
  scaleCanvasMaxSide,
  type AnnotatedCompositeResult,
} from "@/lib/job-photo-annotation-export-composite";
import {
  ANNOTATED_PRINT_PAGE_CSS,
  buildAnnotatedPrintDocumentBody,
  layoutAnnotatedDrawingOnPdf,
} from "@/lib/job-photo-annotation-export-pdf-print";
import {
  getJobMediaPreviewUrl,
  inferJobMediaItemType,
  jobMediaHasFlattenedAdminExport,
  type JobMediaFileType,
} from "@/lib/job-media-types";
import {
  isImageCustomerVisible,
  isLegacyPhotoCustomerVisible,
} from "@/lib/job-customer-access";
import { isImageEmployeeVisible } from "@/lib/job-employee-access";
import { safeTime } from "@/lib/date-safe";
import {
  formatMessageDate,
  messageAuthorNameFromRecord,
} from "@/lib/format-message-date";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl } from "@/lib/pdf/exportJobsToPdf";
import { loadPdfDocumentFromUrl } from "@/lib/production-worksheet-pdf";
import { renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";

export type JobMediaExportCommentRow = {
  id: string;
  authorName: string;
  message: string;
  createdAtLabel: string;
};

export type JobMediaNotesExportInput = {
  fileName: string;
  jobLabel?: string | null;
  kind: JobMediaFileType;
  openUrl: string;
  fileDoc: Record<string, unknown>;
  approval?: ParsedJobMediaApproval | null;
  comments?: JobMediaExportCommentRow[];
  includeApproval?: boolean;
};

export type JobMediaNotesBundle = {
  title: string;
  jobLabel: string | null;
  fileNote: string | null;
  approval: ParsedJobMediaApproval | null;
  comments: JobMediaExportCommentRow[];
};

export function canJobMediaExportWithNotes(params: {
  mediaScope: "full" | "employeeLimited" | "customer";
  hideJobMediaAdminUi: boolean;
  folder?: Record<string, unknown> | null;
  file: Record<string, unknown>;
}): boolean {
  const { mediaScope, hideJobMediaAdminUi, folder, file } = params;
  if (!folder) {
    if (mediaScope === "customer") {
      return isLegacyPhotoCustomerVisible(file);
    }
    if (mediaScope === "employeeLimited" || hideJobMediaAdminUi) {
      return file.employeeVisible !== false;
    }
    return true;
  }
  if (mediaScope === "customer") {
    return isImageCustomerVisible(folder, file);
  }
  if (mediaScope === "employeeLimited" || hideJobMediaAdminUi) {
    return isImageEmployeeVisible(folder, file);
  }
  return true;
}

export function pickFileCommentsForExport(
  all: Array<Record<string, unknown> & { id: string }>,
  fileId: string,
  opts?: { folderId?: string | null; legacyPhotos?: boolean }
): JobMediaExportCommentRow[] {
  const fid = fileId.trim();
  if (!fid) return [];
  const folderId = opts?.folderId != null ? String(opts.folderId).trim() : "";
  const legacy = opts?.legacyPhotos === true;
  const rows: JobMediaExportCommentRow[] = [];
  for (const c of all) {
    const cf = String(c.fileId ?? "").trim();
    if (cf !== fid) continue;
    const cFolder = c.folderId != null ? String(c.folderId).trim() : "";
    if (legacy) {
      if (cFolder) continue;
    } else if (folderId) {
      if (cFolder !== folderId) continue;
    }
    const msg = String(c.message ?? "").trim();
    if (!msg) continue;
    rows.push({
      id: c.id,
      authorName: messageAuthorNameFromRecord(c),
      message: msg,
      createdAtLabel: formatMessageDate(c),
    });
  }
  const withMs = rows.map((r) => {
    const raw = all.find((x) => x.id === r.id);
    return { r, ms: safeTime(raw?.createdAt) };
  });
  withMs.sort((a, b) => a.ms - b.ms);
  return withMs.map((x) => x.r);
}

export function buildJobMediaNotesBundle(input: JobMediaNotesExportInput): JobMediaNotesBundle {
  const note = typeof input.fileDoc.note === "string" ? input.fileDoc.note.trim() : "";
  return {
    title: input.fileName.trim() || "Soubor",
    jobLabel: input.jobLabel?.trim() || null,
    fileNote: note || null,
    approval: input.includeApproval !== false ? input.approval ?? null : null,
    comments: input.comments ?? [],
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function notesBundleHasContent(bundle: JobMediaNotesBundle): boolean {
  return Boolean(
    bundle.fileNote ||
      bundle.comments.length > 0 ||
      bundle.approval?.requiresCustomerApproval
  );
}

function buildApprovalHtml(a: ParsedJobMediaApproval): string {
  const parts: string[] = [];
  parts.push(
    `<p class="meta"><strong>Schválení zákazníkem:</strong> ${escapeHtml(approvalStatusLabelCs(a.approvalStatus))}</p>`
  );
  if (a.approvalNoteFromAdmin) {
    parts.push(
      `<div class="block"><p class="label">Poznámka k žádosti</p><p class="body">${escapeHtml(a.approvalNoteFromAdmin).replace(/\n/g, "<br/>")}</p></div>`
    );
  }
  if (a.customerComment) {
    parts.push(
      `<div class="block"><p class="label">Připomínka zákazníka</p><p class="body">${escapeHtml(a.customerComment).replace(/\n/g, "<br/>")}</p></div>`
    );
  }
  if (a.approvalRequestedAtMs) {
    parts.push(
      `<p class="meta">Žádost odeslána: ${escapeHtml(new Date(a.approvalRequestedAtMs).toLocaleString("cs-CZ"))}</p>`
    );
  }
  if (a.approvedAtMs) {
    parts.push(
      `<p class="meta">Schváleno: ${escapeHtml(new Date(a.approvedAtMs).toLocaleString("cs-CZ"))}</p>`
    );
  }
  if (a.customerCommentAtMs && a.approvalStatus === "changes_requested") {
    parts.push(
      `<p class="meta">Připomínka odeslána: ${escapeHtml(new Date(a.customerCommentAtMs).toLocaleString("cs-CZ"))}</p>`
    );
  }
  return parts.join("");
}

function buildNotesSectionHtml(bundle: JobMediaNotesBundle): string {
  const chunks: string[] = [];
  if (bundle.jobLabel) {
    chunks.push(`<p class="meta">Zakázka: ${escapeHtml(bundle.jobLabel)}</p>`);
  }
  chunks.push(`<h2 class="notes-title">Poznámky k souboru: ${escapeHtml(bundle.title)}</h2>`);
  if (bundle.fileNote) {
    chunks.push(
      `<div class="block"><p class="label">Poznámka k souboru</p><p class="body">${escapeHtml(bundle.fileNote).replace(/\n/g, "<br/>")}</p></div>`
    );
  }
  if (bundle.approval?.requiresCustomerApproval) {
    chunks.push(buildApprovalHtml(bundle.approval));
  }
  if (bundle.comments.length) {
    chunks.push(`<p class="label">Odpovědi / diskuze u souboru</p>`);
    chunks.push('<ul class="thread">');
    for (const c of bundle.comments) {
      chunks.push(
        `<li><p class="thread-head"><strong>${escapeHtml(c.authorName)}</strong> · ${escapeHtml(c.createdAtLabel)}</p><p class="body">${escapeHtml(c.message).replace(/\n/g, "<br/>")}</p></li>`
      );
    }
    chunks.push("</ul>");
  }
  if (!notesBundleHasContent(bundle)) {
    chunks.push(`<p class="meta">K tomuto souboru nejsou uloženy žádné poznámky.</p>`);
  }
  return chunks.join("\n");
}

const PRINT_CSS = `
html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.45;}
.wrap{max-width:100%;padding:12mm 10mm;box-sizing:border-box;}
.doc img{display:block;max-width:100%;height:auto;margin:0 auto 8mm;}
.doc .pdf-pages img{margin-bottom:6mm;}
.notes{margin-top:6mm;padding-top:4mm;border-top:1px solid #cbd5e1;}
.notes-title{font-size:16px;margin:0 0 8px;}
.label{font-size:12px;font-weight:600;color:#334155;margin:0 0 4px;}
.body{margin:0 0 10px;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap;}
.meta{font-size:12px;color:#475569;margin:0 0 6px;}
.block{margin-bottom:10px;}
.thread{list-style:none;padding:0;margin:0;}
.thread li{margin:0 0 12px;padding:0 0 12px;border-bottom:1px solid #e2e8f0;}
.thread-head{font-size:12px;color:#475569;margin:0 0 4px;}
.office-msg{padding:8mm;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;}
.page-break-before{page-break-before:always;}
@media print{
  @page{margin:10mm;size:auto;}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
`;

function safeFileNameBase(name: string): string {
  const t = (name || "soubor")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  return t || "soubor";
}

async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  const url = src.trim();
  if (!url) throw new Error("Chybí URL souboru.");
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Obrázek nelze načíst."));
      img.src = url;
    });
  }
  const dataUrl = await fetchImageAsDataUrl(url);
  if (!dataUrl) throw new Error("Obrázek nelze načíst (síť nebo CORS).");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Obrázek nelze vykreslit."));
    img.src = dataUrl;
  });
}

function readAnnotationsForExport(
  fileDoc: Record<string, unknown>,
  width: number,
  height: number
): JobPhotoAnnotation[] {
  const raw = readAnnotationPayloadFromPhotoDoc(fileDoc);
  if (!raw) return [];
  return deserializeJobPhotoAnnotations(raw, width, height);
}

async function resolveExportVisualCanvas(
  input: JobMediaNotesExportInput
): Promise<{
  canvas: HTMLCanvasElement | null;
  pdfPageImages: string[];
  annotatedBuilt: AnnotatedCompositeResult | null;
}> {
  const url = input.openUrl.trim();
  const kind = input.kind;
  const fileDoc = input.fileDoc;

  if (kind === "office" || kind === "csv") {
    return { canvas: null, pdfPageImages: [], annotatedBuilt: null };
  }

  const hasFlattened = jobMediaHasFlattenedAdminExport(
    fileDoc as { annotatedImageUrl?: string }
  );
  const payloadRaw = readAnnotationPayloadFromPhotoDoc(fileDoc);

  if (kind === "image") {
    const img = await loadHtmlImage(url);
    const w = Math.max(1, img.naturalWidth || img.width);
    const h = Math.max(1, img.naturalHeight || img.height);
    const annotations = hasFlattened ? [] : readAnnotationsForExport(fileDoc, w, h);
    if (annotations.length > 0) {
      const built = await buildAnnotatedCompositeCanvas({
        mode: "image",
        pdfDocument: null,
        pdfPageOneBased: 1,
        imageElement: img,
        annotations,
        colorToHex: defaultHexForDimensionColor,
      });
      return {
        canvas: built.drawingCanvas,
        pdfPageImages: [],
        annotatedBuilt: built,
      };
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas není k dispozici.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas: c, pdfPageImages: [], annotatedBuilt: null };
  }

  if (kind === "pdf") {
    if (!url) throw new Error("PDF nemá platnou URL.");
    let pdf: Awaited<ReturnType<typeof loadPdfDocumentFromUrl>> | null = null;
    try {
      pdf = await loadPdfDocumentFromUrl(url);
      const pageCount = pdf.numPages;
      const page1 = await pdf.getPage(1);
      const vp1 = page1.getViewport({ scale: 1 });
      const annotationsOnFirst =
        payloadRaw && !hasFlattened
          ? readAnnotationsForExport(
              fileDoc,
              Math.max(1, Math.round(vp1.width)),
              Math.max(1, Math.round(vp1.height))
            )
          : [];

      if (!hasFlattened && annotationsOnFirst.length > 0) {
        const built = await buildAnnotatedCompositeCanvas({
          mode: "pdf",
          pdfDocument: pdf,
          pdfPageOneBased: 1,
          imageElement: null,
          annotations: annotationsOnFirst,
          colorToHex: defaultHexForDimensionColor,
        });
        const restPages: string[] = [];
        if (pageCount > 1) {
          const blobs = await renderPdfPagesToPngBlobs(
            url,
            Array.from({ length: pageCount - 1 }, (_, i) => i + 2),
            1.5
          );
          for (const b of blobs) {
            restPages.push(URL.createObjectURL(b));
          }
        }
        return {
          canvas: built.drawingCanvas,
          pdfPageImages: restPages,
          annotatedBuilt: built,
        };
      }

      const blobs = await renderPdfPagesToPngBlobs(
        url,
        Array.from({ length: pageCount }, (_, i) => i + 1),
        1.5
      );
      const dataUrls: string[] = [];
      for (const b of blobs) {
        dataUrls.push(
          await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error("PDF stránku nelze převést."));
            r.readAsDataURL(b);
          })
        );
      }
      return { canvas: null, pdfPageImages: dataUrls, annotatedBuilt: null };
    } finally {
      await pdf?.destroy?.();
    }
  }

  return { canvas: null, pdfPageImages: [], annotatedBuilt: null };
}

function addCanvasToPdfPage(
  doc: jsPDF,
  canvas: HTMLCanvasElement,
  marginMm: number
): void {
  const scaled = scaleCanvasMaxSide(canvas, 5600);
  const pageW = doc.internal.pageSize.getWidth() - 2 * marginMm;
  const pageH = doc.internal.pageSize.getHeight() - 2 * marginMm;
  const pxToMm = 25.4 / 96;
  let dw = Math.min(pageW, scaled.width * pxToMm);
  let dh = (scaled.height / scaled.width) * dw;
  if (dh > pageH) {
    dh = pageH;
    dw = (scaled.width / scaled.height) * dh;
  }
  const x = marginMm + (pageW - dw) / 2;
  const y = marginMm + (pageH - dh) / 2;
  const dataUrl = scaled.toDataURL("image/jpeg", 0.92);
  doc.addImage(dataUrl, "JPEG", x, y, dw, dh);
}

function addImageDataUrlToPdfPage(
  doc: jsPDF,
  dataUrl: string,
  naturalW: number,
  naturalH: number,
  marginMm: number
): void {
  const pageW = doc.internal.pageSize.getWidth() - 2 * marginMm;
  const pageH = doc.internal.pageSize.getHeight() - 2 * marginMm;
  const pxToMm = 25.4 / 96;
  const iw = Math.max(1, naturalW);
  const ih = Math.max(1, naturalH);
  let dw = Math.min(pageW, iw * pxToMm);
  let dh = (ih / iw) * dw;
  if (dh > pageH) {
    dh = pageH;
    dw = (iw / ih) * dh;
  }
  const x = marginMm + (pageW - dw) / 2;
  const y = marginMm + (pageH - dh) / 2;
  doc.addImage(dataUrl, "JPEG", x, y, dw, dh);
}

async function appendNotesPagesToPdf(
  doc: jsPDF,
  bundle: JobMediaNotesBundle,
  fontBasePath?: string
): Promise<void> {
  await registerDejaVuFontsForPdf(doc, fontBasePath ?? "/fonts");
  doc.addPage();
  const margin = 12;
  const pageW = doc.internal.pageSize.getWidth() - 2 * margin;
  let y = 16;
  const lineH = 5.2;

  const addLine = (text: string, opts?: { bold?: boolean; size?: number }) => {
    doc.setFont(PDF_FONT_FAMILY, opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10);
    const lines = doc.splitTextToSize(text, pageW) as string[];
    for (const line of lines) {
      if (y > doc.internal.pageSize.getHeight() - margin - 8) {
        doc.addPage();
        y = 16;
      }
      doc.text(line, margin, y);
      y += lineH;
    }
  };

  addLine(`Poznámky k souboru: ${bundle.title}`, { bold: true, size: 12 });
  y += 2;
  if (bundle.jobLabel) addLine(`Zakázka: ${bundle.jobLabel}`, { size: 9 });
  if (bundle.fileNote) {
    y += 2;
    addLine("Poznámka k souboru", { bold: true });
    addLine(bundle.fileNote);
  }
  if (bundle.approval?.requiresCustomerApproval) {
    y += 2;
    addLine(`Schválení zákazníkem: ${approvalStatusLabelCs(bundle.approval.approvalStatus)}`, {
      bold: true,
    });
    if (bundle.approval.approvalNoteFromAdmin) {
      addLine("Poznámka k žádosti", { bold: true });
      addLine(bundle.approval.approvalNoteFromAdmin);
    }
    if (bundle.approval.customerComment) {
      addLine("Připomínka zákazníka", { bold: true });
      addLine(bundle.approval.customerComment);
    }
    if (bundle.approval.approvalRequestedAtMs) {
      addLine(
        `Žádost odeslána: ${new Date(bundle.approval.approvalRequestedAtMs).toLocaleString("cs-CZ")}`
      );
    }
    if (bundle.approval.approvedAtMs) {
      addLine(
        `Schváleno: ${new Date(bundle.approval.approvedAtMs).toLocaleString("cs-CZ")}`
      );
    }
  }
  if (bundle.comments.length) {
    y += 2;
    addLine("Odpovědi / diskuze u souboru", { bold: true });
    for (const c of bundle.comments) {
      y += 1;
      addLine(`${c.authorName} · ${c.createdAtLabel}`, { size: 9 });
      addLine(c.message);
    }
  }
  if (!notesBundleHasContent(bundle)) {
    addLine("K tomuto souboru nejsou uloženy žádné poznámky.");
  }
}

export async function exportJobMediaWithNotesPdf(
  input: JobMediaNotesExportInput,
  opts?: { fontBasePath?: string }
): Promise<void> {
  const bundle = buildJobMediaNotesBundle(input);
  const visual = await resolveExportVisualCanvas(input);
  const marginMm = 10;

  let doc: jsPDF | null = null;

  if (visual.annotatedBuilt) {
    const d = visual.annotatedBuilt.drawingCanvas;
    const isLandscape = d.width >= d.height;
    doc = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    await layoutAnnotatedDrawingOnPdf(doc, visual.annotatedBuilt);
    if (visual.pdfPageImages.length > 0) {
      for (let i = 0; i < visual.pdfPageImages.length; i++) {
        const dataUrl = visual.pdfPageImages[i]!;
        const img = await loadHtmlImage(dataUrl);
        const orient =
          (img.naturalWidth || img.width) >= (img.naturalHeight || img.height)
            ? "landscape"
            : "portrait";
        doc.addPage(orient);
        addImageDataUrlToPdfPage(
          doc,
          dataUrl,
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
          marginMm
        );
      }
    }
  } else if (visual.canvas) {
    const isLandscape = visual.canvas.width >= visual.canvas.height;
    doc = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    addCanvasToPdfPage(doc, visual.canvas, marginMm);
  } else if (visual.pdfPageImages.length > 0) {
    for (let i = 0; i < visual.pdfPageImages.length; i++) {
      const dataUrl = visual.pdfPageImages[i]!;
      const img = await loadHtmlImage(dataUrl);
      const orient =
        (img.naturalWidth || img.width) >= (img.naturalHeight || img.height)
          ? "landscape"
          : "portrait";
      if (!doc) {
        doc = new jsPDF({ orientation: orient, unit: "mm", format: "a4" });
      } else {
        doc.addPage(orient);
      }
      addImageDataUrlToPdfPage(
        doc,
        dataUrl,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        marginMm
      );
    }
  }

  if (!doc) {
    doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await registerDejaVuFontsForPdf(doc, opts?.fontBasePath ?? "/fonts");
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(12);
    doc.text(`Soubor: ${bundle.title}`, 12, 20);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(10);
    const kindLabel =
      input.kind === "office"
        ? "Office dokument"
        : input.kind === "csv"
          ? "CSV"
          : "Soubor";
    doc.text(
      `${kindLabel} — viz příloha v aplikaci. Níže jsou poznámky k souboru.`,
      12,
      28,
      { maxWidth: doc.internal.pageSize.getWidth() - 24 }
    );
    if (input.openUrl) {
      doc.setFontSize(8);
      doc.text(`URL: ${input.openUrl.slice(0, 120)}`, 12, 40, {
        maxWidth: doc.internal.pageSize.getWidth() - 24,
      });
    }
  }

  await appendNotesPagesToPdf(doc, bundle, opts?.fontBasePath);
  doc.save(`${safeFileNameBase(bundle.title)}-poznamky.pdf`);

  for (const u of visual.pdfPageImages) {
    if (u.startsWith("blob:")) URL.revokeObjectURL(u);
  }
}

export async function printJobMediaWithNotes(
  input: JobMediaNotesExportInput
): Promise<void> {
  const bundle = buildJobMediaNotesBundle(input);
  const notesHtml = buildNotesSectionHtml(bundle);
  const visual = await resolveExportVisualCanvas(input);

  let docHtml = "";
  let extraPrintCss = "";
  if (input.kind === "office" || input.kind === "csv") {
    docHtml = `<div class="office-msg"><p><strong>${escapeHtml(bundle.title)}</strong> — ${input.kind === "office" ? "Office dokument" : "CSV soubor"}.</p><p class="meta">Pro tisk celého souboru použijte „Otevřít v novém okně“. Níže jsou poznámky k tomuto souboru.</p></div>`;
  } else if (visual.annotatedBuilt) {
    const built = buildAnnotatedPrintDocumentBody(visual.annotatedBuilt);
    docHtml = built.bodyInner;
    extraPrintCss = `@media print{${built.pageSizeCss}}`;
    if (visual.pdfPageImages.length) {
      docHtml += `<div class="doc pdf-pages">${visual.pdfPageImages
        .map((u) => `<img src="${u}" alt="" />`)
        .join("")}</div>`;
    }
  } else if (visual.canvas) {
    const dataUrl = scaleCanvasMaxSide(visual.canvas, 5600).toDataURL("image/png");
    docHtml = `<div class="doc"><img src="${dataUrl}" alt="" /></div>`;
  } else if (visual.pdfPageImages.length) {
    docHtml = `<div class="doc pdf-pages">${visual.pdfPageImages
      .map((u) => `<img src="${u}" alt="" />`)
      .join("")}</div>`;
  } else if (input.openUrl) {
    docHtml = `<div class="doc"><img src="${escapeHtml(input.openUrl)}" alt="" /></div>`;
  }

  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    throw new Error("Prohlížeč zablokoval okno — povolte vyskakovací okna pro tisk.");
  }

  const html = `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><title>${escapeHtml(bundle.title)} — tisk</title><style>${ANNOTATED_PRINT_PAGE_CSS}${PRINT_CSS}${extraPrintCss}</style></head><body><div class="wrap">${docHtml}<div class="notes page-break-before">${notesHtml}</div></div><script>
(function(){
  function doPrint(){ try { window.focus(); window.print(); } catch(e) {} }
  var imgs = document.images;
  if (!imgs.length) { setTimeout(doPrint, 250); return; }
  var left = imgs.length;
  function done(){ left--; if (left<=0) setTimeout(doPrint, 200); }
  for (var i=0;i<imgs.length;i++){
    if (imgs[i].complete) done();
    else { imgs[i].onload = done; imgs[i].onerror = done; }
  }
})();
<\/script></body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();

  for (const u of visual.pdfPageImages) {
    if (u.startsWith("blob:")) URL.revokeObjectURL(u);
  }
}

/** Sestaví vstup pro export z řádku ve fotodokumentaci / složce. */
export function jobMediaNotesExportInputFromRow(params: {
  row: Record<string, unknown>;
  fileName: string;
  jobLabel?: string | null;
  comments?: JobMediaExportCommentRow[];
  includeApproval?: boolean;
}): JobMediaNotesExportInput | null {
  const openUrl = getJobMediaPreviewUrl(
    params.row as Parameters<typeof getJobMediaPreviewUrl>[0]
  );
  const kind = inferJobMediaItemType(params.row as { fileName?: string; fileType?: string });
  if ((kind === "image" || kind === "pdf") && !openUrl) return null;
  if ((kind === "office" || kind === "csv") && !openUrl && !params.row.note) {
    const hasComments = (params.comments?.length ?? 0) > 0;
    const approval = parseJobMediaApproval(params.row);
    if (!hasComments && !approval.requiresCustomerApproval && !params.row.note) {
      return null;
    }
  }
  return {
    fileName: params.fileName,
    jobLabel: params.jobLabel,
    kind,
    openUrl: openUrl || "",
    fileDoc: params.row,
    approval: parseJobMediaApproval(params.row),
    comments: params.comments,
    includeApproval: params.includeApproval,
  };
}
