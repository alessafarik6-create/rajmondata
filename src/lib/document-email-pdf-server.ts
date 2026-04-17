/**
 * PDF přílohy pro odeslání dokumentů e-mailem — čistě na serveru z Firestore `pdfHtml`.
 * Vercel serverless: puppeteer-core + @sparticuz/chromium (žádný klasický puppeteer).
 * HTML je vždy řetězec z DB — žádné window/document, žádné načítání portálové URL.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { DocumentEmailType } from "@/lib/document-email-outbound";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import { sanitizeInvoicePreviewHtml } from "@/lib/invoice-a4-html";
import { serializeUnknownForLog } from "@/lib/server-error-serialize";

const MAX_PDF_BYTES = 9 * 1024 * 1024;
const LOG = "[document-email-pdf]";

function logPdf(phase: string, detail?: string): void {
  const tail = detail != null && detail !== "" ? ` ${detail}` : "";
  console.info(`${LOG} ${phase}${tail}`);
}

function logPdfError(phase: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`${LOG} ${phase} FAILED`, {
    message: e.message,
    stack: e.stack,
    serialized: serializeUnknownForLog(err),
  });
}

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function existsFile(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function findLocalChromeExecutable(): string | null {
  const platform = process.platform;
  if (platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const la = process.env.LOCALAPPDATA || "";
    const candidates = [
      // Chrome
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      la ? path.join(la, "Google", "Chrome", "Application", "chrome.exe") : "",
      // Edge (často dostupný i bez Chrome)
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      la ? path.join(la, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    ].filter(Boolean);
    for (const p of candidates) {
      if (existsFile(p)) return p;
    }
    return null;
  }
  if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const p of candidates) {
      if (existsFile(p)) return p;
    }
    return null;
  }
  // linux
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ];
  for (const p of candidates) {
    if (existsFile(p)) return p;
  }
  return null;
}

/**
 * Na Vercelu musí být cesta k `chromium.br` — výchozí __dirname uvnitř balíčku po bundlu Next často nefunguje.
 */
function resolveChromiumBinDir(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "node_modules", "@sparticuz", "chromium", "bin"),
    path.join(cwd, "..", "node_modules", "@sparticuz", "chromium", "bin"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "chromium.br"))) {
      logPdf("chromium.bin", `resolved=${dir}`);
      return dir;
    }
  }
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@sparticuz/chromium/package.json");
    const dir = path.join(path.dirname(pkgJson), "bin");
    if (fs.existsSync(path.join(dir, "chromium.br"))) {
      logPdf("chromium.bin", `resolved via require=${dir}`);
      return dir;
    }
  } catch {
    /* ignore */
  }
  throw new Error(
    `Nelze najít @sparticuz/chromium/bin/chromium.br (cwd=${cwd}). Ověřte production dependency.`
  );
}

async function launchPdfBrowser(): Promise<Browser> {
  const isVercel = process.env.VERCEL === "1";
  const customRaw = String(
    process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ""
  ).trim();

  if (!isVercel) {
    const localExec = customRaw || findLocalChromeExecutable() || "";
    if (!localExec) {
      const hint =
        "Nenalezen lokální Chrome/Edge. Nastavte CHROME_EXECUTABLE_PATH (např. na Windows: C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe).";
      logPdfError("browser.localChrome.resolve", new Error(hint));
      throw new Error(hint);
    }
    logPdf("browser", `pre-launch localChrome path=${localExec}`);
    const localArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];
    logPdf("browser", `local args=${localArgs.join(" ")}`);
    try {
      const browser = await puppeteer.launch({
        executablePath: localExec,
        headless: true,
        args: localArgs,
      });
      logPdf("browser", "launch ok (local Chrome/Edge)");
      return browser;
    } catch (e) {
      logPdfError("browser.localChrome.launch", e);
      throw e;
    }
  }

  logPdf("chromium", "pre-launch serverless (Vercel / @sparticuz/chromium + puppeteer-core)");
  const binDir = resolveChromiumBinDir();
  const brPath = path.join(binDir, "chromium.br");
  try {
    const st = fs.statSync(brPath);
    logPdf("chromium.pack", `chromium.br exists=true bytes=${st.size} path=${brPath}`);
  } catch (statErr) {
    logPdfError("chromium.pack.stat", statErr);
    logPdf("chromium.pack", `chromium.br exists=false path=${brPath}`);
  }
  let executablePath: string;
  try {
    // novější verze umí bez argumentu; ponecháme fallback pro starší/odlišné prostředí
    executablePath = await chromium.executablePath().catch(() => chromium.executablePath(binDir));
  } catch (e) {
    logPdfError("chromium.executablePath", e);
    throw e;
  }
  logPdf("chromium", `executablePath=${executablePath}`);
  logPdf("chromium", `argsCount=${chromium.args.length}`);
  logPdf(
    "chromium",
    `executablePath len=${executablePath.length} path=${executablePath}`
  );

  logPdf("browser", "puppeteer.launch start (args: chromium.args, headless: true)");
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
    logPdf("browser", "puppeteer.launch ok");
    return browser;
  } catch (e) {
    logPdfError("browser.launch", e);
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
  const hash = sha256Hex(trimmed);
  logPdf(
    "html",
    `ready server-side string chars=${trimmed.length} sha256=${hash.slice(0, 12)}… (no window/document)`
  );

  let browser: Browser | null = null;
  try {
    logPdf("chromium", "about to launch browser");
    browser = await launchPdfBrowser();

    logPdf("page", "newPage");
    const page = await browser.newPage();

    logPdf("page", "setContent start waitUntil=networkidle0 timeout=90000");
    await page.setContent(trimmed, {
      waitUntil: "networkidle0",
      timeout: 90_000,
    });
    logPdf("page", "setContent done (networkidle0)");

    logPdf("page", "page.pdf() start format=A4 printBackground=true");
    const pdfUint8 = await page.pdf({
      format: "A4",
      printBackground: true,
    });
    const buf = Buffer.from(pdfUint8);
    logPdf("pdf", `buffer created bytes=${buf.length}`);
    return buf;
  } catch (error) {
    logPdfError("renderStoredHtmlToPdfBuffer", error);
    throw error;
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
  | { ok: false; error: string; detail: string | null };

/**
 * Načte HTML dokladu z Firestore a převede ho na PDF buffer.
 */
export async function getDocumentPdfBuffer(
  input: GetDocumentPdfBufferInput
): Promise<GetDocumentPdfBufferResult> {
  const { db, companyId, jobId, type } = input;

  logPdf("input", `companyId=${companyId} jobId=${jobId} documentType=${type}`);

  if (type === "contract") {
      const cid = String(input.contractId ?? "").trim();
      if (!cid) {
        return {
          ok: false,
          error: "Chybí identifikátor smlouvy.",
          detail: "contractId missing in getDocumentPdfBuffer input",
        };
      }

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
        return {
          ok: false,
          error: "Smlouva nebyla nalezena.",
          detail: `Firestore path=${cref.path} exists=false`,
        };
      }

      const d = (snap.data() ?? {}) as { pdfHtml?: string; contractNumber?: string };
      const raw = String(d.pdfHtml ?? "").trim();
      logPdf("firestore", `contract data keys ok pdfHtmlEmpty=${raw.length === 0}`);
      if (!raw) {
        logPdf("firestore", "contract pdfHtml empty");
        return {
          ok: false,
          error:
            "Smlouva nemá uložený obsah pro PDF. V detailu zakázky otevřete smlouvu a vygenerujte PDF (tím se uloží tisková verze).",
          detail: `Firestore path=${cref.path} exists=true pdfHtmlLen=0`,
        };
      }
      logPdf("firestore", `contract pdfHtml ok len=${raw.length}`);

      const buffer = await renderStoredHtmlToPdfBuffer(raw);
      if (buffer.length > MAX_PDF_BYTES) {
        return {
          ok: false,
          error: "Vygenerované PDF je příliš velké pro odeslání e-mailem.",
          detail: `pdfBytes=${buffer.length} max=${MAX_PDF_BYTES}`,
        };
      }
      const num = String(d.contractNumber ?? "").trim() || cid;
      const safeNum = num.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      logPdf("done", `contract filename=smlouva-${safeNum}.pdf bytes=${buffer.length}`);
      return { ok: true, buffer, filename: `smlouva-${safeNum}.pdf` };
  }

  if (type === "invoice" || type === "advance_invoice") {
      const iid = String(input.invoiceId ?? "").trim();
      if (!iid) {
        return {
          ok: false,
          error: "Chybí identifikátor dokladu.",
          detail: "invoiceId missing in getDocumentPdfBuffer input",
        };
      }

      logPdf("firestore", `invoice companyId=${companyId} invoiceId=${iid}`);
      const iref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("invoices").doc(iid);
      const snap = await iref.get();
      if (!snap.exists) {
        logPdf("firestore", "invoice snapshot missing");
        return {
          ok: false,
          error: "Doklad nebyl nalezen.",
          detail: `Firestore path=${iref.path} exists=false`,
        };
      }

      const data = (snap.data() ?? {}) as Record<string, unknown>;
      if (!isActiveFirestoreDoc(data)) {
        return {
          ok: false,
          error: "Doklad byl odebrán.",
          detail: `Firestore path=${iref.path} isDeleted/inactive`,
        };
      }

      const jobIdOnDoc = String(data.jobId ?? "").trim();
      if (jobIdOnDoc !== jobId) {
        logPdf("firestore", `invoice jobId mismatch doc=${jobIdOnDoc} expected=${jobId}`);
        return {
          ok: false,
          error: "Doklad nepatří k této zakázce.",
          detail: `invoice.jobId=${jobIdOnDoc || "(empty)"} expected=${jobId}`,
        };
      }

      const invType = String(data.type ?? "");
      if (type === "invoice") {
        if (invType !== JOB_INVOICE_TYPES.FINAL_INVOICE) {
          return {
            ok: false,
            error: "Vybraný doklad není vyúčtovací faktura.",
            detail: `invoice.type=${invType || "(empty)"} expected=${JOB_INVOICE_TYPES.FINAL_INVOICE}`,
          };
        }
      } else if (invType !== JOB_INVOICE_TYPES.ADVANCE) {
        return {
          ok: false,
          error: "Vybraný doklad není zálohová faktura.",
          detail: `invoice.type=${invType || "(empty)"} expected=${JOB_INVOICE_TYPES.ADVANCE}`,
        };
      }

      const rawHtml = String(data.pdfHtml ?? "").trim();
      logPdf("firestore", `invoice pdfHtmlEmpty=${rawHtml.length === 0}`);
      if (!rawHtml) {
        logPdf("firestore", "invoice pdfHtml empty");
        return {
          ok: false,
          error: "Doklad nemá uložený obsah pro PDF. Otevřete ho v portálu a uložte znovu.",
          detail: `Firestore path=${iref.path} exists=true pdfHtmlLen=0`,
        };
      }
      logPdf("firestore", `invoice pdfHtml ok len=${rawHtml.length}`);

      const html = sanitizeInvoicePreviewHtml(rawHtml);
      logPdf("html", `invoice sanitized len=${html.length}`);

      const buffer = await renderStoredHtmlToPdfBuffer(html);
      if (buffer.length > MAX_PDF_BYTES) {
        return {
          ok: false,
          error: "Vygenerované PDF je příliš velké pro odeslání e-mailem.",
          detail: `pdfBytes=${buffer.length} max=${MAX_PDF_BYTES}`,
        };
      }

      const num =
        String(
          (data.invoiceNumber as string | undefined) ??
            (data.documentNumber as string | undefined) ??
            ""
        ).trim() || iid;
      const safeNum = num.replace(/[^\w.\-]+/g, "_").slice(0, 80);
      const prefix = type === "advance_invoice" ? "zalohova-faktura" : "faktura";
      logPdf("done", `invoice filename=${prefix}-${safeNum}.pdf bytes=${buffer.length}`);
      return { ok: true, buffer, filename: `${prefix}-${safeNum}.pdf` };
  }

  return {
    ok: false,
    error: "Nepodporovaný typ dokumentu.",
    detail: `type=${type}`,
  };
}

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
