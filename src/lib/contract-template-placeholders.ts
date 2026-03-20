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

/**
 * Proměnné zálohy / doplatku – při prvním vložení šablony ct: nesmí být zapečeny staticky,
 * jinak zmizí z textu a už se nepřepočítají podle formuláře.
 */
export const CONTRACT_FINANCIAL_PLACEHOLDER_KEYS = new Set<string>([
  "zalohova_castka",
  "zalohova_procenta",
  "doplatek",
]);

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

/** Jednotný výstup částky z čísla (např. 50 000 Kč). */
export function formatWorkContractAmountKcFromNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

/** Částka v Kč z textu (prázdný řetězec → prázdný výstup; „0“ → 0 Kč). */
export function formatWorkContractAmountKc(amountStr: string): string {
  const s = String(amountStr ?? "").trim();
  if (s === "") return "";
  const n = Number(s.replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return formatWorkContractAmountKcFromNumber(n);
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
    zalohova_castka: formatWorkContractAmountKc(
      String(opts.zalohovaCastkaRaw ?? "").trim() === ""
        ? "0"
        : String(opts.zalohovaCastkaRaw)
    ),
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
  values: Record<string, string | undefined>
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
