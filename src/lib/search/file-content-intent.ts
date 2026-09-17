/**
 * Intent: hledání půdorysů, výkresů, PDF a obrázků u zakázky.
 */

import { normalizeSearchText } from "@/lib/search/normalize";
import type { SearchEntityType } from "@/lib/search/types";

export const FILE_CONTENT_KEYWORD_GROUPS: Array<{ re: RegExp; label: string; boostTerms: string[] }> = [
  { re: /\bpudorys|\bpůdorys|\bfloor\s*plan|\bplan\b/i, label: "půdorys", boostTerms: ["pudorys", "půdorys", "floorplan", "plan"] },
  { re: /\bvykres|\bvýkres|\bprojekt|\bn[aá]vrh\b/i, label: "výkres", boostTerms: ["vykres", "výkres", "projekt", "nabry"] },
  { re: /\bzamer|\bzaměř|\bmeren|\bměřen/i, label: "zaměření", boostTerms: ["zamereni", "zaměření", "mereni"] },
  { re: /\bfotodokument|\bfoto\b|\bobraz|\bobr[aá]z/i, label: "fotodokumentace", boostTerms: ["foto", "fotografie"] },
  { re: /\bsmlouv/i, label: "smlouva", boostTerms: ["smlouva"] },
  { re: /\bnab[ií]dk/i, label: "nabídka", boostTerms: ["nabidka"] },
  { re: /\bpdf\b|\bpříloh|\bpriloh/i, label: "PDF", boostTerms: ["pdf"] },
];

const STOP_TOKENS = new Set([
  "ukaz",
  "ukaž",
  "najdi",
  "najít",
  "hledej",
  "hledat",
  "pdf",
  "soubor",
  "soubory",
  "dokument",
  "obraz",
  "obrázek",
  "obrazek",
  "foto",
  "fotka",
  "zakazka",
  "zakázka",
  "zakazce",
  "zakázce",
  "zakazku",
  "k",
  "u",
  "ze",
  "z",
  "na",
  "pro",
  "a",
  "i",
  "v",
  "do",
  "od",
  "the",
  "show",
  "find",
]);

export type FileContentIntent = {
  fileContentSearch: boolean;
  fileContentLabel: string | null;
  fileNameBoostTerms: string[];
  preferMime: ("pdf" | "image")[];
};

export function parseFileContentIntent(rawQuery: string): FileContentIntent {
  const norm = normalizeSearchText(rawQuery);
  let fileContentSearch = false;
  let fileContentLabel: string | null = null;
  const fileNameBoostTerms: string[] = [];
  const preferMime: ("pdf" | "image")[] = [];

  for (const g of FILE_CONTENT_KEYWORD_GROUPS) {
    if (g.re.test(rawQuery) || g.re.test(norm)) {
      fileContentSearch = true;
      if (!fileContentLabel) fileContentLabel = g.label;
      fileNameBoostTerms.push(...g.boostTerms);
    }
  }

  if (/\bpdf\b/i.test(rawQuery)) {
    fileContentSearch = true;
    preferMime.push("pdf");
  }
  if (/\bobraz|\bobr[aá]z|\bfoto|\bfotografi/i.test(rawQuery)) {
    fileContentSearch = true;
    preferMime.push("image");
  }
  if (/\bvykres|\bvýkres|\bpudorys|\bpůdorys|\bplan\b/i.test(rawQuery)) {
    preferMime.push("pdf", "image");
  }

  return {
    fileContentSearch,
    fileContentLabel,
    fileNameBoostTerms: [...new Set(fileNameBoostTerms)],
    preferMime: [...new Set(preferMime)],
  };
}

export function entityTypesForFileContentSearch(
  existing: SearchEntityType[] | null
): SearchEntityType[] {
  const set = new Set<SearchEntityType>(existing ?? []);
  set.add("file");
  set.add("document");
  return [...set];
}

/** Odhad názvu zakázky z volného dotazu (např. „půdorys Žemlička“). */
export function extractLikelyJobNameFromQuery(rawQuery: string): string | null {
  const norm = normalizeSearchText(rawQuery);
  const tokens = norm.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const t of tokens) {
    if (STOP_TOKENS.has(t)) continue;
    if (t.length < 3) continue;
    let isFileKw = false;
    for (const g of FILE_CONTENT_KEYWORD_GROUPS) {
      if (g.boostTerms.some((b) => t.includes(b) || b.includes(t))) {
        isFileKw = true;
        break;
      }
    }
    if (isFileKw) continue;
    kept.push(t);
  }
  if (kept.length === 0) return null;
  return kept.slice(-3).join(" ").trim() || null;
}
