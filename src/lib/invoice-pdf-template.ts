/**
 * Verzování HTML/PDF šablony faktur — náhled a archiv originálu.
 */

import { INVOICE_A4_SCREEN_AND_PRINT_CSS } from "@/lib/invoice-a4-html";

/** Aktuální verze layoutu (zvýšit při změně šablony nebo CSS). */
export const INVOICE_PDF_TEMPLATE_VERSION = 2;

/** Metadata při vystavení nového dokladu. */
export function withIssuedInvoicePdfHtml(html: string): {
  pdfHtml: string;
  invoicePdfTemplateVersion: number;
} {
  return {
    pdfHtml: html,
    invoicePdfTemplateVersion: INVOICE_PDF_TEMPLATE_VERSION,
  };
}

export const INVOICE_PDF_FIELD_TEMPLATE_VERSION = "invoicePdfTemplateVersion";
export const INVOICE_PDF_FIELD_PREVIEW = "pdfHtmlPreview";
export const INVOICE_PDF_FIELD_PREVIEW_VERSION = "pdfHtmlPreviewVersion";
export const INVOICE_PDF_FIELD_ARCHIVE = "pdfHtmlArchive";
export const INVOICE_PDF_FIELD_ARCHIVE_AT = "pdfHtmlArchivedAt";

export function readInvoicePdfTemplateVersion(doc: Record<string, unknown>): number {
  const v = doc[INVOICE_PDF_FIELD_TEMPLATE_VERSION];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

export function readInvoicePreviewVersion(doc: Record<string, unknown>): number {
  const v = doc[INVOICE_PDF_FIELD_PREVIEW_VERSION];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** Heuristika starého uloženého HTML (před verzí 2). */
export function legacyInvoiceHtmlMarkers(html: string): boolean {
  const h = String(html ?? "");
  if (!h) return false;
  const body = h.replace(/<style[\s\S]*?<\/style>/gi, "");
  if (/min-height:\s*297mm/i.test(h)) return true;
  if (/class="payment-qr-grid"/i.test(body)) return true;
  if (
    /class="bank-box"/i.test(body) &&
    /alt="QR platba"/i.test(body) &&
    !/class="payment-section"/i.test(body)
  ) {
    return true;
  }
  return false;
}

export function isInvoicePdfTemplateOutdated(
  doc: Record<string, unknown>,
  storedHtml?: string | null
): boolean {
  const issuedVer = readInvoicePdfTemplateVersion(doc);
  if (issuedVer < INVOICE_PDF_TEMPLATE_VERSION) return true;
  const previewVer = readInvoicePreviewVersion(doc);
  const preview = String(doc[INVOICE_PDF_FIELD_PREVIEW] ?? "").trim();
  if (preview && previewVer >= INVOICE_PDF_TEMPLATE_VERSION) return false;
  const html = storedHtml ?? String(doc.pdfHtml ?? "");
  return legacyInvoiceHtmlMarkers(html);
}

/**
 * Nahradí vložené CSS v uloženém HTML aktuální šablonou (záložní cesta bez rebuild dat).
 */
export function upgradeLegacyInvoiceHtmlCss(html: string): string {
  const base = String(html ?? "").trim();
  if (!base) return base;
  const styleBlock = `<style>${INVOICE_A4_SCREEN_AND_PRINT_CSS}</style>`;
  if (/<style[\s\S]*?<\/style>/i.test(base)) {
    return base.replace(/<style[\s\S]*?<\/style>/i, styleBlock);
  }
  if (/<\/head>/i.test(base)) {
    return base.replace(/<\/head>/i, `${styleBlock}</head>`);
  }
  return `${styleBlock}${base}`;
}

export function countPdfPagesFromBuffer(buf: Buffer): number {
  const s = buf.toString("latin1");
  const pages = s.match(/\/Type\s*\/Page\b/g);
  return pages ? pages.length : 0;
}
