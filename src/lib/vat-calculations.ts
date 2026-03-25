/**
 * Jednotné výpočty DPH pro zakázky, náklady a doklady (0 / 12 / 21 %).
 */

import { parseBudgetKcFromJob } from "@/lib/work-contract-deposit";

export const VAT_RATE_OPTIONS = [0, 12, 21] as const;
export type VatRatePercent = (typeof VAT_RATE_OPTIONS)[number];

/** Zda uživatel zadal rozpočet jako částku bez DPH, nebo včetně DPH. */
export type JobBudgetType = "net" | "gross";

/** Výchozí sazba u starých záznamů bez vatRate. */
export const DEFAULT_VAT_RATE: VatRatePercent = 21;

export function normalizeVatRate(raw: unknown): VatRatePercent {
  const n = Number(raw);
  if (n === 0 || n === 12 || n === 21) return n as VatRatePercent;
  return DEFAULT_VAT_RATE;
}

export function normalizeBudgetType(raw: unknown): JobBudgetType {
  if (raw === "gross") return "gross";
  return "net";
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

/**
 * Z částky zadané uživatelem a typu (bez / s DPH) dopočítá net, DPH a gross.
 * Při sazbě 0 % u typu „s DPH“: net = gross = vstup, DPH = 0.
 */
export function computeJobBudgetFromInput(params: {
  budgetInput: number;
  budgetType: JobBudgetType;
  vatRate: VatRatePercent;
}): { budgetNet: number; budgetVat: number; budgetGross: number } {
  const inp = Math.round(Number(params.budgetInput));
  if (!Number.isFinite(inp) || inp < 0) {
    return { budgetNet: 0, budgetVat: 0, budgetGross: 0 };
  }
  if (params.budgetType === "net") {
    const { vatAmount, amountGross } = calculateVatAmountsFromNet(inp, params.vatRate);
    return { budgetNet: inp, budgetVat: vatAmount, budgetGross: amountGross };
  }
  const gross = inp;
  if (params.vatRate === 0) {
    return { budgetNet: gross, budgetVat: 0, budgetGross: gross };
  }
  const net = Math.round(gross / (1 + params.vatRate / 100));
  const vat = gross - net;
  return { budgetNet: net, budgetVat: vat, budgetGross: gross };
}

export type JobBudgetBreakdown = {
  vatRate: VatRatePercent;
  budgetType: JobBudgetType;
  /** Částka zadaná uživatelem (interpretace podle budgetType). */
  budgetInput: number;
  budgetNet: number;
  budgetVat: number;
  budgetGross: number;
};

/**
 * Rozpočet zakázky z Firestore.
 *
 * Pokud je uloženo `budgetInput` + `budgetType`, přepočet z nich.
 * Jinak kompatibilita: jen `budget` / `budgetNet` se považují za zadání **bez DPH**
 * (budgetType net, budgetInput = budgetNet).
 * `budget` u nových záznamů = budgetGross kvůli starším čtenářům.
 */
export function resolveJobBudgetFromFirestore(
  job: Record<string, unknown> | null | undefined
): JobBudgetBreakdown | null {
  if (!job) return null;
  const rate = normalizeVatRate(job.vatRate);
  const typeFromDoc = normalizeBudgetType(job.budgetType);

  const bi = job.budgetInput;
  if (typeof bi === "number" && Number.isFinite(bi) && bi > 0) {
    const inp = Math.round(bi);
    const { budgetNet, budgetVat, budgetGross } = computeJobBudgetFromInput({
      budgetInput: inp,
      budgetType: typeFromDoc,
      vatRate: rate,
    });
    return {
      vatRate: rate,
      budgetType: typeFromDoc,
      budgetInput: inp,
      budgetNet,
      budgetVat,
      budgetGross,
    };
  }

  let budgetNet: number | null = null;
  const bn = job.budgetNet;
  if (typeof bn === "number" && Number.isFinite(bn)) {
    budgetNet = Math.round(bn);
  } else {
    const legacy = parseBudgetKcFromJob(job.budget);
    if (legacy != null) budgetNet = legacy;
  }

  if (budgetNet == null) return null;

  const calc = calculateVatAmountsFromNet(budgetNet, rate);
  let budgetGross = calc.amountGross;
  let budgetVat = calc.vatAmount;

  const storedGross = job.budgetGross;
  if (typeof storedGross === "number" && Number.isFinite(storedGross)) {
    budgetGross = Math.round(storedGross);
    budgetVat = Math.max(0, Math.min(budgetGross, budgetGross - budgetNet));
    const storedVat = job.budgetVat;
    if (typeof storedVat === "number" && Number.isFinite(storedVat)) {
      budgetVat = Math.round(storedVat);
      budgetGross = budgetNet + budgetVat;
    }
  } else {
    const storedVat = job.budgetVat;
    if (typeof storedVat === "number" && Number.isFinite(storedVat)) {
      budgetVat = Math.round(storedVat);
      budgetGross = budgetNet + budgetVat;
    }
  }

  return {
    vatRate: rate,
    budgetType: "net",
    budgetInput: budgetNet,
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
  } else if (
    typeof row.vatAmount === "number" &&
    Number.isFinite(row.vatAmount)
  ) {
    vat = Math.round(row.vatAmount);
    gross = net + vat;
  }
  return { vatRate: rate, amountNet: net, vatAmount: vat, amountGross: gross };
}

/** Payload polí rozpočtu zakázky pro zápis do Firestore (vatRate vždy 0 / 12 / 21). */
export function buildJobBudgetFirestorePayload(params: {
  budgetInput: number;
  budgetType: JobBudgetType;
  vatRate: VatRatePercent;
}): {
  budgetInput: number;
  budgetType: JobBudgetType;
  vatRate: VatRatePercent;
  budgetNet: number;
  budgetVat: number;
  budgetGross: number;
  budget: number;
} {
  const inp = Math.round(Number(params.budgetInput));
  if (!Number.isFinite(inp) || inp <= 0) {
    throw new Error("Rozpočet musí být větší než 0.");
  }
  const { budgetNet, budgetVat, budgetGross } = computeJobBudgetFromInput({
    budgetInput: inp,
    budgetType: params.budgetType,
    vatRate: params.vatRate,
  });
  return {
    budgetInput: inp,
    budgetType: params.budgetType,
    vatRate: params.vatRate,
    budgetNet,
    budgetVat,
    budgetGross,
    budget: budgetGross,
  };
}
