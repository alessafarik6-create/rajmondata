/**
 * Proměnné ve šablonách smlouvy o dílo (oddělovače {{ }}).
 * Nahrazování probíhá v pořadí: nejdřív tyto placeholdery, poté případně
 * tokeny z existujícího applyTemplateVariables (dodavatel.*, objednatel.*, …).
 */

export const CONTRACT_TEMPLATE_PLACEHOLDER_KEYS = [
  "nazev_firmy",
  "jmeno_zakaznika",
  "adresa",
  "ico",
  "datum",
  "nazev_zakazky",
  "cena",
  "zalohova_castka",
  "zalohova_procenta",
  "doplatek",
] as const;

export type ContractTemplatePlaceholderKey =
  (typeof CONTRACT_TEMPLATE_PLACEHOLDER_KEYS)[number];

/** Popis proměnných pro nápovědu v UI (Markdown neužito – čistý text). */
export const CONTRACT_TEMPLATE_PLACEHOLDER_HELP = `
Dostupné proměnné (vložte přesně v uvedeném tvaru):

{{nazev_firmy}} — název vaší firmy (dodavatel)
{{jmeno_zakaznika}} — jméno nebo firma zákazníka
{{adresa}} — adresa zákazníka
{{ico}} — IČO zákazníka
{{datum}} — dnešní datum (česky)
{{nazev_zakazky}} — název aktuální zakázky
{{cena}} — rozpočet zakázky formátovaný v Kč (např. 720 000 Kč)
{{zalohova_castka}} — částka zálohy z formuláře smlouvy (nebo z % a rozpočtu), např. 25 000 Kč; prázdná hodnota → 0 Kč
{{zalohova_procenta}} — záloha v procentech, např. 30 % (prázdné, pokud je jen částka)
{{doplatek}} — doplatek = celková cena díla − záloha (např. 70 000 Kč); bez rozpočtu zakázky prázdné
`.trim();

/** Částka v Kč — stejná logika jako ve formuláři smlouvy (prázdný vstup → 0 Kč). */
export function formatWorkContractAmountKc(amountStr: string): string {
  const n = Number(String(amountStr).replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

export type BuildContractPlaceholderValuesInput = {
  /** Název dodavatelské firmy (z firemního profilu). */
  nazevFirmy: string;
  /** Zobrazené jméno / firma zákazníka. */
  jmenoZakaznika: string;
  /** Adresa zákazníka. */
  adresa: string;
  /** IČO zákazníka. */
  ico: string;
  /** Datum (už naformátovaný řetězec, typicky cs-CZ). */
  datum: string;
  /** Název zakázky. */
  nazevZakazky: string;
  /** Cena včetně měny, např. „720 000 Kč“. */
  cena: string;
  /**
   * Částka zálohy jako číslo v řetězci (bez měny), např. "25000".
   * Prázdný řetězec → dosadí se „0 Kč“.
   */
  zalohovaCastkaRaw: string;
  /** Např. "30 %" nebo prázdné (jen částka bez %). */
  zalohovaProcentaDisplay: string;
  /** Např. "70 000 Kč" nebo prázdné bez rozpočtu. */
  doplatekFormatted: string;
};

/**
 * Vytvoří mapu klíčů přesně podle zápisů v šabloně (např. nazev_firmy).
 */
export function buildContractPlaceholderValues(
  opts: BuildContractPlaceholderValuesInput
): Record<ContractTemplatePlaceholderKey, string> {
  return {
    nazev_firmy: opts.nazevFirmy,
    jmeno_zakaznika: opts.jmenoZakaznika,
    adresa: opts.adresa,
    ico: opts.ico,
    datum: opts.datum,
    nazev_zakazky: opts.nazevZakazky,
    cena: opts.cena,
    zalohova_castka: formatWorkContractAmountKc(opts.zalohovaCastkaRaw),
    zalohova_procenta: opts.zalohovaProcentaDisplay,
    doplatek: opts.doplatekFormatted,
  };
}

/**
 * Nahradí v textu šablony výskyty {{klíč}} hodnotami z mapy.
 * Neznámé klíče ponechá beze změny (zachová původní placeholder).
 */
export function applyContractTemplatePlaceholders(
  template: string,
  values: Record<string, string>
): string {
  if (!template) return "";
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (match, key: string) => {
      const v = values[key];
      return v !== undefined ? v : match;
    }
  );
}
