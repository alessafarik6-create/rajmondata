/**
 * Generický import položek ceníku z HTML stránky (bez natvrdo zabudovaných firem).
 */

import type { AiProductCatalogItemDoc } from "@/lib/ai/ai-center-types";

function parsePriceKc(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseAreaM2(text: string): number | null {
  const m = text.match(/(\d[\d\s.,]*)\s*m\s*[²2]/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Heuristika: řádky s „od X Kč“ a volitelně m² / název modelu.
 */
export function parseCatalogItemsFromHtml(
  companyId: string,
  html: string,
  opts: { category: string; sourceUrl: string }
): Omit<AiProductCatalogItemDoc, "id">[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const items: Omit<AiProductCatalogItemDoc, "id">[] = [];
  const priceRe = /([A-Za-zÁ-ž0-9][A-Za-zÁ-ž0-9\s+\-–]{2,40}?)\s*[-–]?\s*(\d[\d\s.,]*)\s*m\s*[²2][^0-9]{0,40}od\s*([\d\s.,]+)\s*Kč/gi;

  let m: RegExpExecArray | null;
  while ((m = priceRe.exec(text)) !== null) {
    const modelName = m[1].trim();
    const area = parseAreaM2(`${m[2]} m²`);
    const price = parsePriceKc(m[3]);
    if (!modelName || !price) continue;
    items.push({
      companyId,
      category: opts.category,
      modelName,
      priceGross: price,
      currency: "CZK",
      unit: "ks",
      areaM2: area,
      sourceUrl: opts.sourceUrl,
      active: true,
      sortOrder: items.length,
      notes: "Import z webu (orientační cena od)",
    });
  }

  if (items.length === 0) {
    const fallbackRe = /([A-Za-zÁ-ž][A-Za-zÁ-ž0-9\s+\-–]{2,30})\s*[-–]?\s*od\s*([\d\s.,]+)\s*Kč/gi;
    while ((m = fallbackRe.exec(text)) !== null) {
      const modelName = m[1].trim();
      const price = parsePriceKc(m[2]);
      if (!modelName || !price || modelName.length < 3) continue;
      items.push({
        companyId,
        category: opts.category,
        modelName,
        priceGross: price,
        currency: "CZK",
        unit: "ks",
        sourceUrl: opts.sourceUrl,
        active: true,
        sortOrder: items.length,
        notes: "Import z webu",
      });
    }
  }

  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.modelName}|${i.priceGross}|${i.areaM2 ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
