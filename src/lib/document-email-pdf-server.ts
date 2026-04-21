/**
 * PDF přílohy pro odeslání dokumentů e-mailem — na serveru z HTML řetězce (setContent, ne chráněná URL).
 * Smlouva: HTML se sestaví stejně jako tlačítko „Generovat PDF“ (`work-contract-print-html-build`),
 * ne z uloženého `pdfHtml`.
 * Vercel serverless: puppeteer-core + @sparticuz/chromium.
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
import {
  errorStackFromUnknown,
  serializeUnknownForLog,
} from "@/lib/server-error-serialize";
import { buildWorkContractHtmlForEmailAdmin } from "@/lib/work-contract-server-pdf-html";

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
    /** Balíček neexportuje `./package.json` — resolve hlavního vstupu a jdi na `bin` v kořeni balíčku. */
    const mainEntry = require.resolve("@sparticuz/chromium");
    const dir = path.join(path.dirname(mainEntry), "..", "..", "bin");
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

/**
 * @sparticuz/chromium je linuxový balíček. Na Windows/mac (vč. `vercel dev`) vždy lokální Chrome.
 * Na Linuxu ve Vercel/Lambda bez ručního CHROME_EXECUTABLE_PATH použijeme bundled Chromium.
 */
function shouldUseBundledServerlessChromium(): boolean {
  const custom = String(
    process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ""
  ).trim();
  if (custom) return false;
  if (process.platform !== "linux") return false;
  if (process.env.VERCEL === "1" || process.env.VERCEL === "true") return true;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return true;
  if (String(process.env.VERCEL ?? "").length > 0) return true;
  return false;
}

function launchConfigSummary(mode: "local" | "serverless", extra: Record<string, string>): void {
  logPdf("launch.config", JSON.stringify({
    mode,
    platform: process.platform,
    node: process.version,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    ...extra,
  }));
}

async function launchPdfBrowser(): Promise<Browser> {
  const customRaw = String(
    process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ""
  ).trim();
  const useBundled = shouldUseBundledServerlessChromium();

  if (!useBundled) {
    const localExec = customRaw || findLocalChromeExecutable() || "";
    if (!localExec) {
      const hint =
        "Nenalezen lokální Chrome/Edge. Nastavte CHROME_EXECUTABLE_PATH (např. na Windows: C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe).";
      logPdfError("browser.localChrome.resolve", new Error(hint));
      throw new Error(hint);
    }
    launchConfigSummary("local", {
      executablePath: localExec,
      headless: "true(new)",
    });
    const localArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];
    logPdf("browser", `pre-launch localChrome path=${localExec} args=${localArgs.join(" ")}`);
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

  process.env.HOME ??= "/tmp";

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (process.env.VERCEL && nodeMajor > 0 && nodeMajor < 20) {
    logPdf(
      "warn",
      "Vercel s Node.js < 20: @sparticuz/chromium nemusí rozbalit al2023.tar.br — v nastavení projektu zvolte Node 20+ (doporučeno pro Chromium na Vercelu)."
    );
  }

  logPdf("chromium", "pre-launch serverless (@sparticuz/chromium + puppeteer-core; headless must match shell build)");
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
    executablePath = await chromium.executablePath(binDir);
  } catch (e) {
    logPdfError("chromium.executablePath(binDir)", e);
    throw e;
  }
  /**
   * @sparticuz/chromium v131+ a zejm. v147+ nemá `chromium.headless` — režim je v `args` jako
   * `--headless='shell'`. `headless: true` u Puppeteer 24 by přidalo `--headless=new` a režimy by
   * kolidovaly → „Failed to launch the browser process!“. Proto `headless: false` a nechat jen
   * `chromium.args` (doporučení upstream).
   */
  launchConfigSummary("serverless", {
    binDir,
    executablePath,
    headless: "false(Puppeteer)+shell-in-args",
    chromiumArgCount: String(chromium.args.length),
  });
  logPdf("chromium", `executablePath len=${executablePath.length}`);

  logPdf(
    "browser",
    "puppeteer.launch start headless=false (shell headless only from chromium.args)"
  );
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: false,
    });
    logPdf("browser", "puppeteer.launch ok (serverless chromium)");
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
  try {
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

      logPdf("html", "building print HTML from Firestore (same as „Generovat PDF“)");
      const built = await buildWorkContractHtmlForEmailAdmin(db, companyId, jobId, cid);
      if (!built.ok) {
        logPdfError(
          "contract.buildHtml",
          new Error(built.detail ? `${built.error} | ${built.detail}` : built.error)
        );
        return {
          ok: false,
          error: built.error,
          detail: built.detail,
        };
      }
      const raw = built.html;
      logPdf(
        "html",
        `contract print HTML ok chars=${raw.length} sha256=${sha256Hex(raw).slice(0, 12)}…`
      );

      let buffer: Buffer;
      try {
        buffer = await renderStoredHtmlToPdfBuffer(raw);
      } catch (pdfErr: unknown) {
        const stack = String(
          errorStackFromUnknown(pdfErr) ?? serializeUnknownForLog(pdfErr) ?? ""
        );
        logPdfError("contract.renderPdf", pdfErr);
        return {
          ok: false,
          error: "Nepodařilo se vykreslit PDF ze smlouvy.",
          detail: stack.slice(0, 12_000),
        };
      }
      if (buffer.length > MAX_PDF_BYTES) {
        return {
          ok: false,
          error: "Vygenerované PDF je příliš velké pro odeslání e-mailem.",
          detail: `pdfBytes=${buffer.length} max=${MAX_PDF_BYTES}`,
        };
      }
      const num = String(built.form.contractNumber ?? "").trim() || cid;
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

      let buffer: Buffer;
      try {
        buffer = await renderStoredHtmlToPdfBuffer(html);
      } catch (pdfErr: unknown) {
        const stack = String(
          errorStackFromUnknown(pdfErr) ?? serializeUnknownForLog(pdfErr) ?? ""
        );
        logPdfError("invoice.renderPdf", pdfErr);
        return {
          ok: false,
          error: "Nepodařilo se vykreslit PDF z dokladu.",
          detail: stack.slice(0, 12_000),
        };
      }
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
  } catch (err: unknown) {
    logPdfError("getDocumentPdfBuffer.unhandled", err);
    const detailRaw = errorStackFromUnknown(err) ?? serializeUnknownForLog(err);
    const detail =
      typeof detailRaw === "string" ? detailRaw : String(detailRaw ?? "");
    return {
      ok: false,
      error: "Nepodařilo se připravit PDF přílohu.",
      detail: detail.slice(0, 12_000),
    };
  }
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
