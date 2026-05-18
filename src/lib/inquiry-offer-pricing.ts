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
