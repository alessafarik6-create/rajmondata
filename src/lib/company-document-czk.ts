import { roundMoney2 } from "@/lib/vat-calculations";

export type CompanyDocCurrency = "CZK" | "EUR";

export function normalizeDocumentCurrency(
  raw: unknown
): CompanyDocCurrency {
  return raw === "EUR" ? "EUR" : "CZK";
}

export type AmountsOriginal = {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
};

/**
 * Přepočet částek z EUR do CZK (kurz = kolik Kč za 1 EUR).
 */
export function amountsToCzk(
  currency: CompanyDocCurrency,
  rateEurCzk: number,
  a: AmountsOriginal
): {
  amountNetCZK: number;
  vatAmountCZK: number;
  amountGrossCZK: number;
  castkaCZK: number;
} {
  if (currency !== "EUR") {
    const net = roundMoney2(a.amountNet);
    const vat = roundMoney2(a.vatAmount);
    const gross = roundMoney2(a.amountGross);
    return {
      amountNetCZK: net,
      vatAmountCZK: vat,
      amountGrossCZK: gross,
      castkaCZK: gross,
    };
  }
  const m = rateEurCzk;
  const net = roundMoney2(a.amountNet * m);
  const vat = roundMoney2(a.vatAmount * m);
  const gross = roundMoney2(a.amountGross * m);
  return {
    amountNetCZK: net,
    vatAmountCZK: vat,
    amountGrossCZK: gross,
    castkaCZK: gross,
  };
}

/** Hrubá částka v původní měně (pro pole amountOriginal). */
export function grossOriginal(a: AmountsOriginal): number {
  return roundMoney2(a.amountGross);
}
