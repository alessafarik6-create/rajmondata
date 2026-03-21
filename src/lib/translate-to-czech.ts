/**
 * Překlad textu výkazu z ukrajinštiny do češtiny (mock / slovník).
 * V produkci lze nahradit voláním překladového API (Google, DeepL, …).
 */
const UA_CS_PAIRS: [RegExp | string, string][] = [
  [/робота/gi, "práce"],
  [/матеріал/gi, "materiál"],
  [/купити/gi, "koupit"],
  [/потрібно/gi, "je potřeba"],
  [/день/gi, "den"],
  [/годин/gi, "hodin"],
  [/заказ/gi, "zakázka"],
];

export function translateToCzechSync(text: string): string {
  const t = text.trim();
  if (!t) return "";
  let out = t;
  for (const [from, to] of UA_CS_PAIRS) {
    out =
      typeof from === "string" ? out.split(from).join(to) : out.replace(from, to);
  }
  if (out === t) {
    return `[CS] ${t}`;
  }
  return out;
}

export async function translateToCzech(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return "";
  await new Promise((r) => setTimeout(r, 120));
  return translateToCzechSync(t);
}
