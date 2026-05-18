/**
 * Ceny a DPH u e-mailových nabídek.
 */

export const INQUIRY_VAT_RATES = [0, 12, 21] as const;
export type InquiryVatRate = (typeof INQUIRY_VAT_RATES)[number];

export type InquiryOfferPricing = {
  priceNet: number | null;
  vatRate: InquiryVatRate;
  vatAmount: number | null;
  priceGross: number | null;
};

export function normalizeInquiryVatRate(raw: unknown): InquiryVatRate {
  const n = Number(raw);
  if (n === 0 || n === 12 || n === 21) return n;
  return 21;
}

export function calculateInquiryOfferPricing(
  priceNetInput: number | null | undefined,
  vatRateInput: unknown
): InquiryOfferPricing {
  const vatRate = normalizeInquiryVatRate(vatRateInput);
  if (priceNetInput == null || !Number.isFinite(Number(priceNetInput))) {
    return { priceNet: null, vatRate, vatAmount: null, priceGross: null };
  }
  const priceNet = Math.round(Number(priceNetInput) * 100) / 100;
  const vatAmount = Math.round(priceNet * (vatRate / 100) * 100) / 100;
  const priceGross = Math.round((priceNet + vatAmount) * 100) / 100;
  return { priceNet, vatRate, vatAmount, priceGross };
}

export function formatInquiryPriceCz(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return `${Math.round(amount).toLocaleString("cs-CZ")} Kč`;
}

export function formatPricingSummary(p: InquiryOfferPricing): string {
  if (p.priceNet == null) return "—";
  return `${formatInquiryPriceCz(p.priceNet)} bez DPH + DPH ${p.vatRate} % = ${formatInquiryPriceCz(p.priceGross)}`;
}

/** Parsuje cenu z inputu (mezery, čárka, „Kč“). */
export function parseInquiryPriceInput(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw * 100) / 100;
  }
  let t = String(raw).trim();
  t = t.replace(/\s*Kč\s*/gi, "").replace(/\s/g, "").replace(/,/g, ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function formatInquiryOfferPricingBlockPlain(p: InquiryOfferPricing): string {
  if (p.priceNet == null) return "";
  const vatAmount = p.vatAmount ?? 0;
  const gross = p.priceGross ?? p.priceNet + vatAmount;
  return [
    `Cena bez DPH: ${formatInquiryPriceCz(p.priceNet)}`,
    `DPH ${p.vatRate} %: ${formatInquiryPriceCz(vatAmount)}`,
    `Cena s DPH: ${formatInquiryPriceCz(gross)}`,
  ].join("\n");
}

export function bodyAlreadyContainsPricingSummary(body: string): boolean {
  const b = body.toLowerCase();
  return (
    b.includes("cena bez dph") ||
    b.includes("cena s dph") ||
    /\bdph\s*\d+\s*%/.test(b)
  );
}

/** Text e-mailu včetně cenového souhrnu (pokud už není v šabloně). */
export function buildInquiryOfferSentBodyPlain(
  bodyText: string,
  pricing: InquiryOfferPricing
): string {
  const base = bodyText.trim();
  if (pricing.priceNet == null) return base;
  if (bodyAlreadyContainsPricingSummary(base)) return base;
  const block = formatInquiryOfferPricingBlockPlain(pricing);
  if (!block) return base;
  return base ? `${base}\n\n${block}` : block;
}
