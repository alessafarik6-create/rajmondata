/**
 * Tisk uloženého HTML dokladu (faktura, záloha, daňový doklad).
 *
 * Důležité: `window.open("", "_blank", "noopener")` vrací v Chrome `null` — nelze pak volat
 * `document.write()` a vznikne prázdné about:blank. Proto se používá navigace na `blob:` URL
 * a tisk až po načtení dokumentu.
 */

import { sanitizeInvoicePreviewHtml } from "@/lib/invoice-a4-html";

export type PrintHtmlResult = "ok" | "empty" | "blocked";

/**
 * Otevře nové okno s A4 HTML a po načtení zavolá tisk.
 * Nevolá `document.write` do okna s `noopener` (nefunkční / null reference).
 */
export function printInvoiceHtmlDocument(
  rawHtml: string,
  documentTitle: string
): PrintHtmlResult {
  const safe = sanitizeInvoicePreviewHtml(rawHtml);
  if (!safe.trim()) return "empty";

  const blob = new Blob([safe], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  // Bez `noopener` — potřebujeme referenci na okno pro `print()` po načtení blob dokumentu.
  const w = window.open(url, "_blank");
  if (!w) {
    URL.revokeObjectURL(url);
    return "blocked";
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      w.document.title = documentTitle;
    } catch {
      /* blob: je stejný původ */
    }
    requestAnimationFrame(() => {
      try {
        w.focus();
        w.print();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      }
    });
  };

  w.addEventListener("load", finish, { once: true });

  return "ok";
}
