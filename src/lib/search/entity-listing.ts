/**
 * Detekce dotazů typu „ukaž faktury“ / „faktury najdi“ — listing bez textové shody.
 */

import type { SearchEntityType, SearchIntent } from "@/lib/search/types";
import { normalizeSearchText } from "@/lib/search/normalize";

const STOP_WORDS = new Set([
  "najdi",
  "najit",
  "najít",
  "ukaz",
  "ukaž",
  "vsechny",
  "všechny",
  "vse",
  "vše",
  "seznam",
  "prosim",
  "prosím",
  "dej",
  "dejte",
  "zobraz",
  "zobrazit",
  "list",
  "moje",
  "nase",
  "naše",
  "vsechno",
  "všechno",
]);

const ENTITY_KEYWORDS: Record<string, SearchEntityType[]> = {
  faktury: ["invoice"],
  faktura: ["invoice"],
  faktur: ["invoice"],
  doklady: ["document"],
  doklad: ["document"],
  uctenky: ["document", "file"],
  uctenka: ["document", "file"],
  nabidky: ["offer"],
  nabidka: ["offer"],
  nabídky: ["offer"],
  nabídka: ["offer"],
  poptavky: ["inquiry"],
  poptavka: ["inquiry"],
  poptávky: ["inquiry"],
  poptávka: ["inquiry"],
  zakazky: ["job"],
  zakazka: ["job"],
  zakázky: ["job"],
  zakázka: ["job"],
  zakaznik: ["customer"],
  zakaznici: ["customer"],
  zákazník: ["customer"],
  zákazníci: ["customer"],
  katalog: ["product"],
  produkty: ["product"],
};

export function meaningfulQueryTokens(rawQuery: string): string[] {
  const norm = normalizeSearchText(rawQuery);
  return norm
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function isEntityListingIntent(intent: SearchIntent): boolean {
  if (intent.documentNumber) return false;
  if (intent.supplier || intent.customer || intent.jobQuery) return false;
  if (intent.amountMin != null || intent.amountMax != null) return false;
  if (intent.dateFrom || intent.dateTo) return false;

  const tokens = meaningfulQueryTokens(intent.rawQuery);
  if (tokens.length === 0) {
    return Boolean(intent.entityTypes?.length);
  }

  const entityOnlyTokens = tokens.every((t) => {
    if (Object.keys(ENTITY_KEYWORDS).some((kw) => t.includes(kw) || kw.includes(t))) {
      return true;
    }
    return Boolean(
      intent.entityTypes?.some((et) => {
        const labels: Record<SearchEntityType, string[]> = {
          invoice: ["faktur"],
          document: ["doklad", "ucten"],
          offer: ["nabid", "nabíd"],
          inquiry: ["poptav"],
          job: ["zakaz"],
          customer: ["zakazn", "zákazn"],
          product: ["produkt", "katalog"],
          file: ["fot", "pdf", "soubor"],
        };
        return labels[et]?.some((l) => t.includes(l)) ?? false;
      })
    );
  });

  return entityOnlyTokens && Boolean(intent.entityTypes?.length);
}

export function shouldSkipSemanticSearch(intent: SearchIntent): boolean {
  if (isEntityListingIntent(intent)) return true;
  if (isLikelyExactOnlyQuery(intent)) return true;
  const tokens = meaningfulQueryTokens(intent.rawQuery);
  return tokens.length <= 1 && Boolean(intent.entityTypes?.length);
}

function isLikelyExactOnlyQuery(intent: SearchIntent): boolean {
  const key = intent.rawQuery.replace(/\s/g, "");
  return /^[A-Z0-9@._-]{4,}$/i.test(key);
}

export function resolveListingEntityTypes(intent: SearchIntent): SearchEntityType[] | null {
  if (intent.entityTypes?.length) return intent.entityTypes;

  const tokens = meaningfulQueryTokens(intent.rawQuery);
  const types = new Set<SearchEntityType>();
  for (const t of tokens) {
    for (const [kw, ets] of Object.entries(ENTITY_KEYWORDS)) {
      if (t.includes(kw) || kw.includes(t)) {
        ets.forEach((e) => types.add(e));
      }
    }
  }
  return types.size ? [...types] : null;
}
