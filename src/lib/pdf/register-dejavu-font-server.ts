/**
 * Server-side (Node) registrace DejaVu fontů pro PDF — čte TTF ze složky public/fonts.
 * Nepoužívat v klientských komponentách (webpack neumí node:fs).
 */

import fs from "node:fs";
import path from "node:path";
import type { jsPDF } from "jspdf";
import { PDF_FONT_FAMILY } from "@/lib/pdf/register-dejavu-font";

const FONT_NORMAL = "DejaVuSans.ttf";
const FONT_BOLD = "DejaVuSans-Bold.ttf";

let cachedNormalB64: string | null = null;
let cachedBoldB64: string | null = null;

function loadFontBase64sFromDisk(fontsDir: string): { normal: string; bold: string } {
  if (cachedNormalB64 && cachedBoldB64) {
    return { normal: cachedNormalB64, bold: cachedBoldB64 };
  }
  const normalPath = path.join(fontsDir, FONT_NORMAL);
  const boldPath = path.join(fontsDir, FONT_BOLD);
  cachedNormalB64 = fs.readFileSync(normalPath).toString("base64");
  cachedBoldB64 = fs.readFileSync(boldPath).toString("base64");
  return { normal: cachedNormalB64, bold: cachedBoldB64 };
}

export function registerDejaVuFontsForPdfSync(
  doc: jsPDF,
  fontsDir?: string
): void {
  const dir = fontsDir ?? path.join(process.cwd(), "public", "fonts");
  const { normal, bold } = loadFontBase64sFromDisk(dir);
  doc.addFileToVFS(FONT_NORMAL, normal);
  doc.addFileToVFS(FONT_BOLD, bold);
  doc.addFont(FONT_NORMAL, PDF_FONT_FAMILY, "normal", "Identity-H");
  doc.addFont(FONT_BOLD, PDF_FONT_FAMILY, "bold", "Identity-H");
  doc.setFont(PDF_FONT_FAMILY, "normal");
}
