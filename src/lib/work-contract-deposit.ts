/**
 * Parsování a validace zálohy u smlouvy o dílo (částka i procenta).
 */

/** Rozpočet zakázky z Firestore / UI (číslo, řetězec s mezerami apod.). */
export function parseBudgetKcFromJob(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw);
  }
  let s = String(raw)
    .trim()
    .replace(/\s+/g, "")
    .replace(/kč/gi, "")
    .replace(/czk/gi, "");
  if (s === "") return null;
  // Desetinná čárka
  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Odstraní % a zbytečné mezery, převede na číslo. */
export function parsePercentValue(raw: string): number | null {
  const cleaned = String(raw ?? "")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Částka v Kč z textu (řádky s % ignoruje – řeší se jako procenta).
 */
export function parseAmountKc(raw: string): number | null {
  if (/%/.test(String(raw))) return null;
  const cleaned = String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/kč/gi, "")
    .replace(/czk/gi, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Pro šablonu: „30 %“ nebo prázdné. */
export function formatPercentForTemplate(percentStorage: string): string {
  const n = parsePercentValue(percentStorage);
  if (n == null) return "";
  const rounded = Math.round(n * 10000) / 10000;
  const asInt = Math.round(rounded);
  const s =
    Math.abs(rounded - asInt) < 1e-9 ? String(asInt) : String(rounded).replace(".", ",");
  return `${s} %`;
}

/** Efektivní částka zálohy v Kč z uložených polí + rozpočtu. */
export function computeDepositAmountKc(params: {
  depositAmountStr: string;
  depositPercentStr: string;
  budgetKc: number | null;
}): number {
  const amtTrim = String(params.depositAmountStr ?? "").trim();
  if (/%/.test(amtTrim)) {
    const p = parsePercentValue(amtTrim);
    if (p != null && params.budgetKc != null) {
      return Math.round((params.budgetKc * p) / 100);
    }
    return 0;
  }
  const fromAmt = parseAmountKc(amtTrim);
  if (fromAmt != null) return fromAmt;
  const p = parsePercentValue(params.depositPercentStr);
  if (p != null && params.budgetKc != null) {
    return Math.round((params.budgetKc * p) / 100);
  }
  return 0;
}

/** Doplatek = cena díla − záloha (nezáporně). */
export function computeDoplatekKc(
  budgetKc: number | null,
  depositKc: number
): number | null {
  if (budgetKc == null || !Number.isFinite(budgetKc)) return null;
  return Math.max(0, Math.round(budgetKc) - Math.round(depositKc));
}

/** Vrací text chyby nebo null, pokud je záloha v pořádku. */
export function validateWorkContractDeposit(params: {
  depositAmountStr: string;
  depositPercentStr: string;
  budgetKc: number | null;
}): string | null {
  const pctRaw = String(params.depositPercentStr ?? "").trim();
  const amtRaw = String(params.depositAmountStr ?? "").trim();

  if (pctRaw !== "") {
    const pctParsed = parsePercentValue(pctRaw);
    if (pctParsed == null) {
      return "Zadejte platné procento zálohy (např. 30 nebo 30 %).";
    }
    if (pctParsed < 0 || pctParsed > 100) {
      return "Záloha v procentech musí být v rozmezí 0–100 %.";
    }
  }

  if (/%/.test(amtRaw) && parsePercentValue(amtRaw) == null) {
    return "V částce zálohy není platné procento (např. 30 %).";
  }

  const amtTrim = amtRaw;
  const hasPlainAmount =
    !/%/.test(amtTrim) && parseAmountKc(amtTrim) != null;
  const effectiveFromPercent =
    !hasPlainAmount &&
    (/%/.test(amtTrim) ||
      (pctRaw !== "" && parsePercentValue(pctRaw) != null));

  if (
    effectiveFromPercent &&
    (params.budgetKc == null || !Number.isFinite(params.budgetKc))
  ) {
    return "Pro zálohu zadanou v procentech je potřeba u zakázky vyplnit rozpočet.";
  }

  const depKc = computeDepositAmountKc({
    depositAmountStr: params.depositAmountStr,
    depositPercentStr: params.depositPercentStr,
    budgetKc: params.budgetKc,
  });
  if (params.budgetKc != null && Number.isFinite(params.budgetKc)) {
    const total = Math.round(params.budgetKc);
    if (depKc > total) {
      return `Částka zálohy (${depKc.toLocaleString("cs-CZ")} Kč) nesmí být větší než celková cena díla (${total.toLocaleString("cs-CZ")} Kč).`;
    }
  }
  return null;
}
