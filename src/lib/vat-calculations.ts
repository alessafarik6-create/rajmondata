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

/** Zaokrouhlení částky v Kč na 2 desetinná místa (náklady / doklady). */
export function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Náklad / řádek dokladu: z uživatelského vstupu a typu (bez DPH / s DPH) dopočítá net, DPH, gross.
 * Při sazbě 0 % u typu „s DPH“: net = gross = vstup.
 */
export function computeExpenseAmountsFromInput(params: {
  amountInput: number;
  amountType: JobBudgetType;
  vatRate: VatRatePercent;
}): { amountNet: number; vatAmount: number; amountGross: number } {
  const inp = roundMoney2(params.amountInput);
  if (!Number.isFinite(inp) || inp <= 0) {
    return { amountNet: 0, vatAmount: 0, amountGross: 0 };
  }
  if (params.amountType === "net") {
    const amountNet = inp;
    const vatAmount = roundMoney2((amountNet * params.vatRate) / 100);
    const amountGross = roundMoney2(amountNet + vatAmount);
    return { amountNet, vatAmount, amountGross };
  }
  const amountGross = inp;
  if (params.vatRate === 0) {
    return { amountNet: amountGross, vatAmount: 0, amountGross };
  }
  const amountNet = roundMoney2(amountGross / (1 + params.vatRate / 100));
  const vatAmount = roundMoney2(amountGross - amountNet);
  return { amountNet, vatAmount, amountGross };
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

/**
 * Zaplacené částky u zakázky (úhrady z účetní složky + případně ruční pole).
 * Primárně `paidAmountNet` / `paidAmountGross`; legacy `paidAmount` = hrubá částka.
 */
export function resolveJobPaidFromFirestore(
  job: Record<string, unknown> | null | undefined
): { paidNet: number; paidGross: number } {
  if (!job) return { paidNet: 0, paidGross: 0 };
  const pn = Number(job.paidAmountNet);
  const pg = Number(job.paidAmountGross);
  const legacy = Number(job.paidAmount);
  const paidNet = Number.isFinite(pn) ? roundMoney2(pn) : 0;
  let paidGross = Number.isFinite(pg) ? roundMoney2(pg) : 0;
  if (paidGross === 0 && Number.isFinite(legacy) && legacy > 0) {
    paidGross = roundMoney2(legacy);
  }
  return { paidNet, paidGross };
}

/** Částka nákladu / řádku / přijatého dokladu: net, DPH, brutto z uložených polí nebo legacy `amount`. */
export function resolveExpenseAmounts(row: {
  amount?: unknown;
  amountNet?: unknown;
  amountGross?: unknown;
  vatAmount?: unknown;
  vatRate?: unknown;
  amountInput?: unknown;
  amountType?: unknown;
  /** Pro starší doklady (`vat` = %). */
  vat?: unknown;
  /** Přepočtené CZK hodnoty (EUR doklady i nové záznamy s explicitním CZK). */
  castkaCZK?: unknown;
  amountNetCZK?: unknown;
  amountGrossCZK?: unknown;
  vatAmountCZK?: unknown;
  amountCZK?: unknown;
}): {
  vatRate: VatRatePercent;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
} {
  const rawRate =
    row.vatRate !== undefined && row.vatRate !== null ? row.vatRate : row.vat;
  const rate = normalizeVatRate(rawRate);
  const typeFromDoc = normalizeBudgetType(row.amountType);

  const grossCzkCandidate = Math.max(
    Number(row.castkaCZK ?? 0),
    Number(row.amountGrossCZK ?? 0),
    Number(row.amountCZK ?? 0)
  );
  const netCzk = roundMoney2(Number(row.amountNetCZK ?? 0));
  const vatCzk = roundMoney2(Number(row.vatAmountCZK ?? 0));
  const hasExplicitCzk =
    Number.isFinite(grossCzkCandidate) && grossCzkCandidate > 0;
  if (hasExplicitCzk) {
    const gross = roundMoney2(grossCzkCandidate);
    if (netCzk > 0 && gross > 0) {
      const vat =
        vatCzk > 0 ? vatCzk : roundMoney2(Math.max(0, gross - netCzk));
      return {
        vatRate: rate,
        amountNet: netCzk,
        vatAmount: vat,
        amountGross: gross,
      };
    }
    if (rate > 0) {
      const net = roundMoney2(gross / (1 + rate / 100));
      const vat = roundMoney2(gross - net);
      return { vatRate: rate, amountNet: net, vatAmount: vat, amountGross: gross };
    }
    return {
      vatRate: rate,
      amountNet: gross,
      vatAmount: 0,
      amountGross: gross,
    };
  }

  const ai = row.amountInput;
  if (typeof ai === "number" && Number.isFinite(ai) && ai > 0) {
    const inp = roundMoney2(ai);
    const { amountNet, vatAmount, amountGross } = computeExpenseAmountsFromInput({
      amountInput: inp,
      amountType: typeFromDoc,
      vatRate: rate,
    });
    return { vatRate: rate, amountNet, vatAmount, amountGross };
  }

  let net = 0;
  const an = row.amountNet;
  if (typeof an === "number" && Number.isFinite(an)) {
    net = roundMoney2(an);
  } else if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
    net = roundMoney2(row.amount);
  }
  const calc = calculateVatAmountsFromNet(net, rate);
  let gross = roundMoney2(calc.amountGross);
  let vat = roundMoney2(calc.vatAmount);
  const ag = row.amountGross;
  if (typeof ag === "number" && Number.isFinite(ag)) {
    gross = roundMoney2(ag);
    vat = roundMoney2(Math.max(0, gross - net));
  } else if (
    typeof row.vatAmount === "number" &&
    Number.isFinite(row.vatAmount)
  ) {
    vat = roundMoney2(row.vatAmount);
    gross = roundMoney2(net + vat);
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
