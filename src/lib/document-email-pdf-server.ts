/**
 * PDF přílohy pro odeslání dokumentů e-mailem — server (bez base64 z klienta).
 * Chromium: `puppeteer-core` + `@sparticuz/chromium` (Vercel / serverless).
 * Lokálně volitelně `CHROME_EXECUTABLE_PATH` nebo `PUPPETEER_EXECUTABLE_PATH`.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Browser } from "puppeteer-core";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { DocumentEmailType } from "@/lib/document-email-outbound";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import { sanitizeInvoicePreviewHtml } from "@/lib/invoice-a4-html";

const MAX_PDF_BYTES = 9 * 1024 * 1024;
const LOG = "[document-email-pdf]";

function logPdf(phase: string, detail?: string): void {
  const tail = detail != null && detail !== "" ? ` ${detail}` : "";
  console.info(`${LOG} ${phase}${tail}`);
}

function logPdfError(phase: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`${LOG} ${phase} FAILED`, { message: e.message, stack: e.stack });
}

async function launchPdfBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const custom = String(
    process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ""
  ).trim();

  if (custom) {
    logPdf("browser", `mode=customChrome path=${custom}`);
    try {
      return await puppeteer.default.launch({
        executablePath: custom,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    } catch (e) {
      logPdfError("browser.customLaunch", e);
      throw e;
    }
  }

  logPdf("browser", "mode=serverless @sparticuz/chromium + puppeteer-core");
  try {
    const chromiumMod = await import("@sparticuz/chromium");
    const Chromium = chromiumMod.default as {
      executablePath: (input?: string) => Promise<string>;
      args: string[];
      defaultViewport: { width: number; height: number; deviceScaleFactor?: number };
      headless: true | "shell";
    };

    const executablePath = await Chromium.executablePath();
    logPdf("chromium", `executablePath len=${executablePath.length} prefix=${executablePath.slice(0, 64)}`);

    const browser = await puppeteer.default.launch({
      args: Chromium.args,
      defaultViewport: Chromium.defaultViewport,
      executablePath,
      headless: Chromium.headless,
    });
    logPdf("browser", "launched ok");
    return browser;
  } catch (e) {
    logPdfError("browser.sparticuzLaunch", e);
    throw e;
  }
}

/**
 * Vykreslí uložené HTML (celý dokument) do PDF bufferu.
 */
export async function renderStoredHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const trimmed = String(html ?? "").trim();
  if (!trimmed) {
    logPdfError("html", new Error("empty html"));
    throw new Error("Prázdné HTML pro PDF.");
  }
  logPdf("html", `chars=${trimmed.length}`);

  let browser: Browser | null = null;
  try {
    browser = await launchPdfBrowser();
    logPdf("page", "newPage");
    const page = await browser.newPage();

    logPdf("page", "setContent start waitUntil=domcontentloaded");
    await page.setContent(trimmed, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    logPdf("page", "setContent done");

    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));
    logPdf("page", "post-render settle 400ms");

    logPdf("page", "pdf() start");
    const pdfUint8 = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
      preferCSSPageSize: true,
    });
    const buf = Buffer.from(pdfUint8);
    logPdf("page", `pdf() done bytes=${buf.length}`);
    return buf;
  } catch (e) {
    logPdfError("renderStoredHtmlToPdfBuffer", e);
    throw e;
  } finally {
    if (browser) {
      try {
        await browser.close();
        logPdf("browser", "closed");
      } catch (closeErr) {
        logPdfError("browser.close", closeErr);
      }
    }
  }
}

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

function publicPdfError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("timeout")) {
    return "Vypršel čas při vykreslování PDF na serveru.";
  }
  const dev =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "development";
  if (dev && msg.length > 0) {
    return `Generování PDF selhalo: ${msg.slice(0, 400)}`;
  }
  return "Generování PDF na serveru selhalo. Zkuste to prosím znovu; pokud chyba přetrvává, zkontrolujte logy nasazení (Chromium / paměť).";
}

/**
 * Načte HTML dokladu z Firestore a převede ho na PDF buffer.
 */
export async function getDocumentPdfBuffer(
  input: GetDocumentPdfBufferInput
): Promise<GetDocumentPdfBufferResult> {
  const { db, companyId, jobId, type } = input;

  try {
    if (type === "contract") {
      const cid = String(input.contractId ?? "").trim();
      if (!cid) return { ok: false, error: "Chybí identifikátor smlouvy." };

      logPdf("firestore", `contract companyId=${companyId} jobId=${jobId} contractId=${cid}`);
      const cref = db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("jobs")
        .doc(jobId)
        .collection("workContracts")
        .doc(cid);
      const snap = await cref.get();
      if (!snap.exists) {
        logPdf("firestore", "contract snapshot missing");
        return { ok: false, error: "Smlouva nebyla nalezena." };
      }

      const d = snap.data() as { pdfHtml?: string; contractNumber?: string };
      const raw = String(d.pdfHtml ?? "").trim();
      if (!raw) {
        logPdf("firestore", "contract pdfHtml empty");
        return {
          ok: false,
          error:
            "Smlouva nemá uložený obsah pro PDF. V detailu zakázky otevřete smlouvu a vygenerujte PDF (tím se uloží tisková verze).",
        };
      }
      logPdf("firestore", `contract pdfHtml ok len=${raw.length}`);

      const buffer = await renderStoredHtmlToPdfBuffer(raw);
      if (buffer.length > MAX_PDF_BYTES) {
        return { ok: false, error: "Vygenerované PDF je příliš velké pro odeslání e-mailem." };
      }
      const num = String(d.contractNumber ?? "").trim() || cid;
      const safeNum = num.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      logPdf("done", `contract filename=smlouva-${safeNum}.pdf`);
      return { ok: true, buffer, filename: `smlouva-${safeNum}.pdf` };
    }

    if (type === "invoice" || type === "advance_invoice") {
      const iid = String(input.invoiceId ?? "").trim();
      if (!iid) return { ok: false, error: "Chybí identifikátor dokladu." };

      logPdf("firestore", `invoice companyId=${companyId} invoiceId=${iid}`);
      const iref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("invoices").doc(iid);
      const snap = await iref.get();
      if (!snap.exists) {
        logPdf("firestore", "invoice snapshot missing");
        return { ok: false, error: "Doklad nebyl nalezen." };
      }

      const data = snap.data() as Record<string, unknown>;
      if (!isActiveFirestoreDoc(data)) {
        return { ok: false, error: "Doklad byl odebrán." };
      }

      const jobIdOnDoc = String(data.jobId ?? "").trim();
      if (jobIdOnDoc !== jobId) {
        logPdf("firestore", `invoice jobId mismatch doc=${jobIdOnDoc} expected=${jobId}`);
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
        logPdf("firestore", "invoice pdfHtml empty");
        return {
          ok: false,
          error: "Doklad nemá uložený obsah pro PDF. Otevřete ho v portálu a uložte znovu.",
        };
      }
      logPdf("firestore", `invoice pdfHtml ok len=${rawHtml.length}`);

      const html = sanitizeInvoicePreviewHtml(rawHtml);
      logPdf("html", `invoice sanitized len=${html.length}`);

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
      logPdf("done", `invoice filename=${prefix}-${safeNum}.pdf`);
      return { ok: true, buffer, filename: `${prefix}-${safeNum}.pdf` };
    }

    return { ok: false, error: "Nepodporovaný typ dokumentu." };
  } catch (e) {
    logPdfError("getDocumentPdfBuffer", e);
    return { ok: false, error: publicPdfError(e) };
  }
}

/** Alias pro smlouvu — stejné jako {@link getDocumentPdfBuffer} s typem `contract`. */
export async function generateContractPdfBuffer(
  input: Omit<GetDocumentPdfBufferInput, "type" | "invoiceId"> & { contractId: string }
): Promise<GetDocumentPdfBufferResult> {
  return getDocumentPdfBuffer({
    ...input,
    type: "contract",
    invoiceId: null,
    contractId: input.contractId,
  });
}
