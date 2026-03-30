import { cn } from "@/lib/utils";

/** Normalizace pro porovnání (diakritika, mezery, case). */
function normalizeForMatch(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export type InquiryTypeKind = "modulove_domy" | "pergoly" | "obecne" | "unknown";

/**
 * Rozpozná hlavní typ poptávky z textu ze zdroje (různé zápisy bez změny uložených dat).
 */
export function classifyInquiryType(raw: string | undefined | null): InquiryTypeKind {
  const t = normalizeForMatch(String(raw ?? ""));
  if (!t) return "unknown";

  if (t.includes("modul") && (t.includes("dom") || t.includes("dum"))) {
    return "modulove_domy";
  }
  if (t.includes("pergol")) {
    return "pergoly";
  }
  if (t.includes("obecn")) {
    return "obecne";
  }

  return "unknown";
}

/** Pevné barvy pozadí + vždy černý text (bez žluté / amber). */
const BADGE_BY_KIND: Record<
  Exclude<InquiryTypeKind, "unknown">,
  string
> = {
  modulove_domy:
    "border-blue-500/90 bg-blue-200 text-black shadow-none hover:bg-blue-200 dark:border-blue-400 dark:bg-blue-300 dark:text-black",
  pergoly:
    "border-green-600/90 bg-green-200 text-black shadow-none hover:bg-green-200 dark:border-green-500 dark:bg-green-300 dark:text-black",
  obecne:
    "border-red-500/90 bg-red-200 text-black shadow-none hover:bg-red-200 dark:border-red-500 dark:bg-red-300 dark:text-black",
};

const FALLBACK_BADGE =
  "border-slate-400/90 bg-slate-200 text-black shadow-none hover:bg-slate-200 dark:border-slate-500 dark:bg-slate-300 dark:text-black";

/**
 * Tailwind třídy pro `Badge` (variant outline + tyto barvy přebijí výchozí vzhled).
 */
export function getInquiryTypeBadgeClass(type: string | undefined | null): string {
  const kind = classifyInquiryType(type);
  if (kind === "unknown") {
    return cn("border font-medium", FALLBACK_BADGE);
  }
  return cn("border font-medium", BADGE_BY_KIND[kind]);
}
