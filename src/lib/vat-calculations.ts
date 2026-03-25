/**
 * Jednotné výpočty DPH pro zakázky, náklady a doklady (0 / 12 / 21 %).
 */

import { parseBudgetKcFromJob } from "@/lib/work-contract-deposit";

export const VAT_RATE_OPTIONS = [0, 12, 21] as const;
export type VatRatePercent = (typeof VAT_RATE_OPTIONS)[number];

/** Výchozí sazba u starých záznamů bez vatRate. */
export const DEFAULT_VAT_RATE: VatRatePercent = 21;

export function normalizeVatRate(raw: unknown): VatRatePercent {
  const n = Number(raw);
  if (n === 0 || n === 12 || n === 21) return n as VatRatePercent;
  return DEFAULT_VAT_RATE;
}

export type VatComputed = {
  vatAmount: number;
  amountGross: number;
};

/**
 * Z částky bez DPH a sazby v % spočítá DPH a částku s DPH (zaokrouhleno na celé Kč).
 */
export function calculateVatAmountsFromNet(
  amountNet: number,
  vatRate: VatRatePercent
): VatComputed {
  if (!Number.isFinite(amountNet) || amountNet < 0) {
    return { vatAmount: 0, amountGross: 0 };
  }
  const net = Math.round(amountNet);
  const vatAmount = Math.round((net * vatRate) / 100);
  return { vatAmount, amountGross: net + vatAmount };
}

export type JobBudgetBreakdown = {
  vatRate: VatRatePercent;
  budgetNet: number;
  budgetVat: number;
  budgetGross: number;
};

/**
 * Rozpočet zakázky z Firestore.
 *
 * Kompatibilita: pokud chybí budgetNet/budgetGross a existuje jen `budget`,
 * považuje se za částku bez DPH a doplní se DPH podle vatRate (výchozí 21 %).
 * Pole `budget` u nových záznamů udržujte jako budgetGross kvůli starším čtenářům.
 */
export function resolveJobBudgetFromFirestore(
  job: Record<string, unknown> | null | undefined
): JobBudgetBreakdown | null {
  if (!job) return null;
  const rate = normalizeVatRate(job.vatRate);

  let budgetNet: number | null = null;
  const bn = job.budgetNet;
  if (typeof bn === "number" && Number.isFinite(bn)) {
    budgetNet = Math.round(bn);
  } else {
    const legacy = parseBudgetKcFromJob(job.budget);
    if (legacy != null) budgetNet = legacy;
  }

  if (budgetNet == null || budgetNet < 0) return null;

  const calc = calculateVatAmountsFromNet(budgetNet, rate);
  let budgetGross = calc.amountGross;
  let budgetVat = calc.vatAmount;

  const storedGross = job.budgetGross;
  if (typeof storedGross === "number" && Number.isFinite(storedGross)) {
    budgetGross = Math.round(storedGross);
    budgetVat = Math.max(0, Math.min(budgetGross, budgetGross - budgetNet));
  } else {
    const storedVat = job.budgetVat;
    if (typeof storedVat === "number" && Number.isFinite(storedVat)) {
      budgetVat = Math.round(storedVat);
      budgetGross = budgetNet + budgetVat;
    }
  }

  return {
    vatRate: rate,
    budgetNet,
    budgetVat,
    budgetGross,
  };
}

/** Částka nákladu / řádku / přijatého dokladu: net, DPH, brutto z uložených polí nebo legacy `amount`. */
export function resolveExpenseAmounts(row: {
  amount?: unknown;
  amountNet?: unknown;
  amountGross?: unknown;
  vatAmount?: unknown;
  vatRate?: unknown;
  /** Pro starší doklady (`vat` = %). */
  vat?: unknown;
}): {
  vatRate: VatRatePercent;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
} {
  const rawRate =
    row.vatRate !== undefined && row.vatRate !== null ? row.vatRate : row.vat;
  const rate = normalizeVatRate(rawRate);
  let net = 0;
  const an = row.amountNet;
  if (typeof an === "number" && Number.isFinite(an)) {
    net = Math.round(an);
  } else if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
    net = Math.round(row.amount);
  }
  const calc = calculateVatAmountsFromNet(net, rate);
  let gross = calc.amountGross;
  let vat = calc.vatAmount;
  const ag = row.amountGross;
  if (typeof ag === "number" && Number.isFinite(ag)) {
    gross = Math.round(ag);
    vat = Math.max(0, gross - net);
  } else if (typeof row.vatAmount === "number" && Number.isFinite(row.vatAmount)) {
    vat = Math.round(row.vatAmount);
    gross = net + vat;
  }
  return { vatRate: rate, amountNet: net, vatAmount: vat, amountGross: gross };
}

/** Payload polí rozpočtu zakázky pro zápis do Firestore. */
export function buildJobBudgetFirestorePayload(params: {
  budgetNet: number;
  vatRate: VatRatePercent;
}): {
  vatRate: VatRatePercent;
  budgetNet: number;
  budgetVat: number;
  budgetGross: number;
  budget: number;
} {
  const net = Math.max(0, Math.round(params.budgetNet));
  const { vatAmount, amountGross } = calculateVatAmountsFromNet(net, params.vatRate);
  return {
    vatRate: params.vatRate,
    budgetNet: net,
    budgetVat: vatAmount,
    budgetGross: amountGross,
    budget: amountGross,
  };
}
