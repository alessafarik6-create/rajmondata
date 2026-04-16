/**
 * Převod uloženého tiskového HTML (smlouva, faktura) na PDF v prohlížeči — pro e-mailové přílohy.
 * Pouze na klientu (iframe + html2canvas + jsPDF).
 */

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function uint8ToBase64(u: Uint8Array): string {
  const chunk = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < u.length; i += chunk) {
    const sub = u.subarray(i, i + chunk);
    parts.push(String.fromCharCode.apply(null, Array.from(sub) as number[]));
  }
  return btoa(parts.join(""));
}

/**
 * Vykreslí celý HTML dokument (včetně &lt;head&gt; stylů) do PDF A4 (jedna nebo více stránek).
 */
export async function htmlDocumentStringToPdfBase64(fullHtml: string): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("Generování PDF je dostupné jen v prohlížeči.");
  }
  const html = String(fullHtml ?? "").trim();
  if (!html) {
    throw new Error("Chybí HTML dokumentu pro PDF.");
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "pdf-render");
  iframe.style.cssText =
    "position:fixed;left:-12000px;top:0;width:900px;height:1200px;border:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      const idoc = iframe.contentDocument;
      if (!idoc) {
        reject(new Error("Nelze vytvořit dokument iframe."));
        return;
      }
      const onLoad = () => {
        iframe.removeEventListener("load", onLoad);
        resolve();
      };
      iframe.addEventListener("load", onLoad);
      iframe.onerror = () => reject(new Error("Načtení HTML pro PDF selhalo."));
      iframe.srcdoc = html;
    });

    const idoc = iframe.contentDocument;
    const root = idoc?.documentElement;
    if (!root) {
      throw new Error("Prázdný obsah dokumentu.");
    }

    await new Promise((r) => setTimeout(r, 300));

    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: root.scrollWidth,
      height: root.scrollHeight,
      windowWidth: root.scrollWidth,
      windowHeight: root.scrollHeight,
      foreignObjectRendering: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const buf = pdf.output("arraybuffer") as ArrayBuffer;
    return uint8ToBase64(new Uint8Array(buf));
  } finally {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
  }
}
