import {
  computeExpenseAmountsFromInput,
  normalizeVatRate,
  roundMoney2,
  VAT_RATE_OPTIONS,
  type VatRatePercent,
} from "@/lib/vat-calculations";
import type { PortalManualFormItem } from "@/lib/portal-manual-invoice";

export type PortalInvoiceDiscountType = "percent" | "fixed";

export type PortalInvoiceDocumentDiscount = {
  discountType: PortalInvoiceDiscountType | null;
  discountValue: number;
};

export function parsePortalInvoiceDocumentDiscount(
  inv: Record<string, unknown> | null | undefined
): PortalInvoiceDocumentDiscount {
  if (!inv) return { discountType: null, discountValue: 0 };
  const t = String(inv.invoiceDiscountType ?? "").trim();
  const discountType: PortalInvoiceDiscountType | null =
    t === "percent" || t === "fixed" ? t : null;
  const discountValue = Math.max(0, Number(inv.invoiceDiscountValue) || 0);
  if (!discountType || discountValue <= 0) {
    return { discountType: null, discountValue: 0 };
  }
  return { discountType, discountValue };
}

export function parseLineDiscountFromFirestore(row: Record<string, unknown>): {
  discountType: PortalInvoiceDiscountType | null;
  discountValue: number;
} {
  const t = String(row.discountType ?? "").trim();
  const discountType: PortalInvoiceDiscountType | null =
    t === "percent" || t === "fixed" ? t : null;
  const discountValue = Math.max(0, Number(row.discountValue) || 0);
  if (!discountType || discountValue <= 0) {
    return { discountType: null, discountValue: 0 };
  }
  return { discountType, discountValue };
}

export function computeDiscountAmount(
  baseNet: number,
  discountType: PortalInvoiceDiscountType | null,
  discountValue: number
): number {
  const base = Math.max(0, roundMoney2(baseNet));
  if (!discountType || discountValue <= 0 || base <= 0) return 0;
  if (discountType === "percent") {
    const pct = Math.min(100, Math.max(0, discountValue));
    return roundMoney2(base * (pct / 100));
  }
  return roundMoney2(Math.min(base, Math.max(0, discountValue)));
}

export function validateLineDiscount(
  baseNet: number,
  discountType: PortalInvoiceDiscountType | null,
  discountValue: number
): string | null {
  if (!discountType || discountValue <= 0) return null;
  if (discountType === "percent") {
    if (discountValue > 100) return "Sleva v % nesmí být vyšší než 100.";
    if (discountValue < 0) return "Neplatná sleva.";
    return null;
  }
  if (discountValue > baseNet + 0.009) {
    return "Sleva v Kč nesmí být vyšší než základ položky.";
  }
  return null;
}

export type ComputedPortalInvoiceLine = {
  itemId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceNet: number;
  vatRate: VatRatePercent;
  lineNetBeforeDiscount: number;
  discountType: PortalInvoiceDiscountType | null;
  discountValue: number;
  discountAmount: number;
  lineNet: number;
  lineVat: number;
  lineGross: number;
  /** Základ po všech slevách (vč. celkové slevy na faktuře) — pro fakturovanou částku u zakázky. */
  billNet: number;
  billVat: number;
  billGross: number;
};

export type PortalInvoiceTotalsWithDiscounts = {
  lines: ComputedPortalInvoiceLine[];
  subtotalNetBeforeDiscount: number;
  lineDiscountTotal: number;
  subtotalNetAfterLineDiscounts: number;
  invoiceDiscountAmount: number;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  vatBreakdown: Array<{ rate: VatRatePercent; base: number; vat: number }>;
};

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

/** Výpočet řádků: slevy na položkách, poté volitelná sleva na celou fakturu (poměrně dle DPH základů). */
export function computePortalInvoiceTotalsWithDiscounts(
  items: PortalManualFormItem[],
  invoiceDiscount?: PortalInvoiceDocumentDiscount | null
): PortalInvoiceTotalsWithDiscounts {
  const vatMap = new Map<VatRatePercent, { base: number; vat: number }>();
  for (const rate of VAT_RATE_OPTIONS) {
    vatMap.set(rate, { base: 0, vat: 0 });
  }

  const lines: ComputedPortalInvoiceLine[] = [];
  let subtotalNetBeforeDiscount = 0;
  let lineDiscountTotal = 0;

  for (const it of items) {
    const qty = Math.max(0, Number(it.quantity) || 0);
    const unitInput = Math.max(0, Number(it.unitPrice) || 0);
    const desc = trim(it.description);
    if (!desc || qty <= 0 || unitInput <= 0) continue;

    const vatRate = normalizeVatRate(it.vatRate);
    const unitComputed = computeExpenseAmountsFromInput({
      amountInput: unitInput,
      amountType: it.priceType === "net" ? "net" : "gross",
      vatRate,
    });
    const lineNetBeforeDiscount = roundMoney2(unitComputed.amountNet * qty);
    const discountType = it.discountType ?? null;
    const discountValue = Math.max(0, Number(it.discountValue) || 0);
    const err = validateLineDiscount(lineNetBeforeDiscount, discountType, discountValue);
    if (err) {
      throw new Error(`${desc}: ${err}`);
    }
    const discountAmount = computeDiscountAmount(
      lineNetBeforeDiscount,
      discountType,
      discountValue
    );
    const lineNet = roundMoney2(Math.max(0, lineNetBeforeDiscount - discountAmount));
    const lineVat = roundMoney2(lineNet * (vatRate / 100));
    const lineGross = roundMoney2(lineNet + lineVat);
    const unitNet = roundMoney2(unitComputed.amountNet);

    subtotalNetBeforeDiscount = roundMoney2(subtotalNetBeforeDiscount + lineNetBeforeDiscount);
    lineDiscountTotal = roundMoney2(lineDiscountTotal + discountAmount);

    const bucket = vatMap.get(vatRate)!;
    bucket.base = roundMoney2(bucket.base + lineNet);
    bucket.vat = roundMoney2(bucket.vat + lineVat);

    lines.push({
      itemId: String(it.id),
      description: desc,
      quantity: qty,
      unit: trim(it.unit) || "ks",
      unitPriceNet: unitNet,
      vatRate,
      lineNetBeforeDiscount,
      discountType,
      discountValue,
      discountAmount,
      lineNet,
      lineVat,
      lineGross,
      billNet: lineNet,
      billVat: lineVat,
      billGross: lineGross,
    });
  }

  let subtotalNetAfterLineDiscounts = roundMoney2(subtotalNetBeforeDiscount - lineDiscountTotal);
  let invoiceDiscountAmount = 0;

  const docDisc = invoiceDiscount ?? { discountType: null, discountValue: 0 };
  if (
    docDisc.discountType &&
    docDisc.discountValue > 0 &&
    subtotalNetAfterLineDiscounts > 0
  ) {
    if (docDisc.discountType === "percent" && docDisc.discountValue > 100) {
      throw new Error("Celková sleva v % nesmí být vyšší než 100.");
    }
    invoiceDiscountAmount = computeDiscountAmount(
      subtotalNetAfterLineDiscounts,
      docDisc.discountType,
      docDisc.discountValue
    );
    if (invoiceDiscountAmount > 0) {
      const ratesWithBase = VAT_RATE_OPTIONS.filter((rate) => {
        const b = vatMap.get(rate)!.base;
        return b > 0;
      });
      let remaining = invoiceDiscountAmount;
      ratesWithBase.forEach((rate, idx) => {
        const bucket = vatMap.get(rate)!;
        const share =
          idx === ratesWithBase.length - 1
            ? remaining
            : roundMoney2(
                invoiceDiscountAmount *
                  (bucket.base / subtotalNetAfterLineDiscounts)
              );
        remaining = roundMoney2(remaining - share);
        bucket.base = roundMoney2(Math.max(0, bucket.base - share));
        bucket.vat = roundMoney2(bucket.base * (rate / 100));
      });
    }
  }

  if (invoiceDiscountAmount > 0 && subtotalNetAfterLineDiscounts > 0) {
    const eligible = lines.filter((l) => l.lineNet > 0);
    let remainingDisc = invoiceDiscountAmount;
    eligible.forEach((line, idx) => {
      const share =
        idx === eligible.length - 1
          ? remainingDisc
          : roundMoney2(
              invoiceDiscountAmount * (line.lineNet / subtotalNetAfterLineDiscounts)
            );
      remainingDisc = roundMoney2(remainingDisc - share);
      line.billNet = roundMoney2(Math.max(0, line.lineNet - share));
      line.billVat = roundMoney2(line.billNet * (line.vatRate / 100));
      line.billGross = roundMoney2(line.billNet + line.billVat);
    });
  }

  let amountNet = 0;
  let vatAmount = 0;
  const vatBreakdown: Array<{ rate: VatRatePercent; base: number; vat: number }> = [];
  for (const rate of VAT_RATE_OPTIONS) {
    const bucket = vatMap.get(rate)!;
    if (bucket.base <= 0 && bucket.vat <= 0) continue;
    amountNet = roundMoney2(amountNet + bucket.base);
    vatAmount = roundMoney2(vatAmount + bucket.vat);
    vatBreakdown.push({ rate, base: bucket.base, vat: bucket.vat });
  }
  const amountGross = roundMoney2(amountNet + vatAmount);

  return {
    lines,
    subtotalNetBeforeDiscount,
    lineDiscountTotal,
    subtotalNetAfterLineDiscounts,
    invoiceDiscountAmount,
    amountNet,
    vatAmount,
    amountGross,
    vatBreakdown,
  };
}
