/**
 * Načte DejaVu Sans z /fonts/*.ttf (public, kopíruje postinstall z dejavu-fonts-ttf)
 * a zaregistruje ho v instanci jsPDF pro češtinu a číslice (Identity-H).
 */

import type { jsPDF } from "jspdf";

const FONT_NORMAL = "DejaVuSans.ttf";
const FONT_BOLD = "DejaVuSans-Bold.ttf";
/** Interní název rodiny pro setFont / autoTable */
export const PDF_FONT_FAMILY = "DejaVuSans";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[]
    );
  }
  return btoa(binary);
}

let cachedNormalB64: string | null = null;
let cachedBoldB64: string | null = null;

async function loadFontBase64s(fontBasePath: string): Promise<{ normal: string; bold: string }> {
  if (cachedNormalB64 && cachedBoldB64) {
    return { normal: cachedNormalB64, bold: cachedBoldB64 };
  }
  const base = fontBasePath.replace(/\/$/, "");
  const [nRes, bRes] = await Promise.all([
    fetch(`${base}/${FONT_NORMAL}`),
    fetch(`${base}/${FONT_BOLD}`),
  ]);
  if (!nRes.ok || !bRes.ok) {
    throw new Error(
      `Nelze načíst fonty PDF (${nRes.status} / ${bRes.status}). Spusťte npm install (postinstall zkopíruje fonty do public/fonts).`
    );
  }
  const [nBuf, bBuf] = await Promise.all([nRes.arrayBuffer(), bRes.arrayBuffer()]);
  cachedNormalB64 = arrayBufferToBase64(nBuf);
  cachedBoldB64 = arrayBufferToBase64(bBuf);
  return { normal: cachedNormalB64, bold: cachedBoldB64 };
}

/**
 * Přidá DejaVu Sans normal + bold do VFS daného dokumentu a zaregistruje rodinu `DejaVuSans`.
 */
export async function registerDejaVuFontsForPdf(
  doc: jsPDF,
  fontBasePath = "/fonts"
): Promise<void> {
  const { normal, bold } = await loadFontBase64s(fontBasePath);
  doc.addFileToVFS(FONT_NORMAL, normal);
  doc.addFileToVFS(FONT_BOLD, bold);
  /** 4. argument může být u jsPDF přímo kódování (Identity-H pro UTF-8 / diakritiku). */
  doc.addFont(FONT_NORMAL, PDF_FONT_FAMILY, "normal", "Identity-H");
  doc.addFont(FONT_BOLD, PDF_FONT_FAMILY, "bold", "Identity-H");
  doc.setFont(PDF_FONT_FAMILY, "normal");
}
