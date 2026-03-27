import { roundMoney2 } from "@/lib/vat-calculations";

/** Výchozí kurz při nedostupnosti API (orientační). */
export const FALLBACK_EUR_CZK_RATE = 25;

let lastSuccessfulRate = FALLBACK_EUR_CZK_RATE;

/**
 * Aktuální kurz CZK za 1 EUR (např. 24,85).
 * open.er-api.com — bez klíče, CORS pro prohlížeč.
 */
async function fetchEurCzkFromApi(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/EUR", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    result?: string;
    rates?: { CZK?: number };
  };
  if (data.result !== "success" || !data.rates?.CZK) {
    throw new Error("invalid response");
  }
  const r = Number(data.rates.CZK);
  if (!Number.isFinite(r) || r <= 0) throw new Error("bad rate");
  return roundMoney2(r);
}

export type ResolveEurCzkResult = {
  rate: number;
  usedFallback: boolean;
};

/**
 * Vrátí kurz EUR→CZK. Při chybě API použije poslední úspěšný kurz, jinak fallback.
 */
export async function resolveEurCzkRate(): Promise<ResolveEurCzkResult> {
  try {
    const rate = await fetchEurCzkFromApi();
    lastSuccessfulRate = rate;
    return { rate, usedFallback: false };
  } catch {
    const rate =
      lastSuccessfulRate > 0
        ? lastSuccessfulRate
        : FALLBACK_EUR_CZK_RATE;
    return { rate, usedFallback: true };
  }
}
