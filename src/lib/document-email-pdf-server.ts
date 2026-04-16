/**
 * PDF přílohy pro odeslání dokumentů e-mailem — výhradně na serveru (bez base64 v HTTP z klienta).
 * Zdroj: uložené `pdfHtml` ve Firestore + Puppeteer (tisk A4).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { DocumentEmailType } from "@/lib/document-email-outbound";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import { sanitizeInvoicePreviewHtml } from "@/lib/invoice-a4-html";

const MAX_PDF_BYTES = 9 * 1024 * 1024;

export type GetDocumentPdfBufferInput = {
  db: Firestore;
  companyId: string;
  jobId: string;
  type: DocumentEmailType;
  contractId: string | null;
  invoiceId: string | null;
};

export type GetDocumentPdfBufferResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; error: string };

async function renderStoredHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 90_000 });
    const pdfUint8 = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}

/**
 * Načte HTML dokladu z Firestore a převede ho na PDF buffer (Puppeteer).
 */
export async function getDocumentPdfBuffer(
  input: GetDocumentPdfBufferInput
): Promise<GetDocumentPdfBufferResult> {
  const { db, companyId, jobId, type } = input;

  try {
    if (type === "contract") {
      const cid = String(input.contractId ?? "").trim();
      if (!cid) return { ok: false, error: "Chybí identifikátor smlouvy." };

      const cref = db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("jobs")
        .doc(jobId)
        .collection("workContracts")
        .doc(cid);
      const snap = await cref.get();
      if (!snap.exists) return { ok: false, error: "Smlouva nebyla nalezena." };

      const d = snap.data() as { pdfHtml?: string; contractNumber?: string };
      const raw = String(d.pdfHtml ?? "").trim();
      if (!raw) {
        return {
          ok: false,
          error:
            "Smlouva nemá uložený obsah pro PDF. V detailu zakázky otevřete smlouvu a vygenerujte PDF (tím se uloží tisková verze).",
        };
      }

      const buffer = await renderStoredHtmlToPdfBuffer(raw);
      if (buffer.length > MAX_PDF_BYTES) {
        return { ok: false, error: "Vygenerované PDF je příliš velké pro odeslání e-mailem." };
      }
      const num = String(d.contractNumber ?? "").trim() || cid;
      const safeNum = num.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      return { ok: true, buffer, filename: `smlouva-${safeNum}.pdf` };
    }

    if (type === "invoice" || type === "advance_invoice") {
      const iid = String(input.invoiceId ?? "").trim();
      if (!iid) return { ok: false, error: "Chybí identifikátor dokladu." };

      const iref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("invoices").doc(iid);
      const snap = await iref.get();
      if (!snap.exists) return { ok: false, error: "Doklad nebyl nalezen." };

      const data = snap.data() as Record<string, unknown>;
      if (!isActiveFirestoreDoc(data)) {
        return { ok: false, error: "Doklad byl odebrán." };
      }

      const jobIdOnDoc = String(data.jobId ?? "").trim();
      if (jobIdOnDoc !== jobId) {
        return { ok: false, error: "Doklad nepatří k této zakázce." };
      }

      const invType = String(data.type ?? "");
      if (type === "invoice") {
        if (invType !== JOB_INVOICE_TYPES.FINAL_INVOICE) {
          return { ok: false, error: "Vybraný doklad není vyúčtovací faktura." };
        }
      } else if (invType !== JOB_INVOICE_TYPES.ADVANCE) {
        return { ok: false, error: "Vybraný doklad není zálohová faktura." };
      }

      const rawHtml = String(data.pdfHtml ?? "").trim();
      if (!rawHtml) {
        return {
          ok: false,
          error: "Doklad nemá uložený obsah pro PDF. Otevřete ho v portálu a uložte znovu.",
        };
      }

      const html = sanitizeInvoicePreviewHtml(rawHtml);
      const buffer = await renderStoredHtmlToPdfBuffer(html);
      if (buffer.length > MAX_PDF_BYTES) {
        return { ok: false, error: "Vygenerované PDF je příliš velké pro odeslání e-mailem." };
      }

      const num =
        String(
          (data.invoiceNumber as string | undefined) ??
            (data.documentNumber as string | undefined) ??
            ""
        ).trim() || iid;
      const safeNum = num.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      const prefix = type === "advance_invoice" ? "zalohova-faktura" : "faktura";
      return { ok: true, buffer, filename: `${prefix}-${safeNum}.pdf` };
    }

    return { ok: false, error: "Nepodporovaný typ dokumentu." };
  } catch (e) {
    console.error("[document-email-pdf-server]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("timeout")) {
      return { ok: false, error: "Vypršel čas při vykreslování PDF na serveru." };
    }
    return {
      ok: false,
      error:
        "Server nevygeneroval PDF. Zkontrolujte prostředí (Chrome/Puppeteer) nebo zkuste znovu později.",
    };
  }
}
