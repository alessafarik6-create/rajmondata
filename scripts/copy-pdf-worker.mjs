/**
 * Zkopíruje pdf.js worker z npm balíčku do public/ — bez CDN (unpkg).
 */
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcMjs = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const destDir = join(root, "public");
const destMjs = join(destDir, "pdf.worker.mjs");

if (!existsSync(srcMjs)) {
  console.warn("[copy-pdf-worker] Přeskočeno — chybí pdfjs-dist/build/pdf.worker.min.mjs.");
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(srcMjs, destMjs);
console.log("[copy-pdf-worker] OK → public/pdf.worker.mjs");
