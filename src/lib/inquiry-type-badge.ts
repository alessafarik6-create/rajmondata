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

const BADGE_BY_KIND: Record<
  Exclude<InquiryTypeKind, "unknown">,
  string
> = {
  modulove_domy:
    "border-indigo-300/80 bg-indigo-100 text-indigo-950 shadow-none hover:bg-indigo-100 dark:border-indigo-700/80 dark:bg-indigo-950/50 dark:text-indigo-50",
  pergoly:
    "border-emerald-300/80 bg-emerald-100 text-emerald-950 shadow-none hover:bg-emerald-100 dark:border-emerald-700/80 dark:bg-emerald-950/50 dark:text-emerald-50",
  obecne:
    "border-amber-300/80 bg-amber-100 text-amber-950 shadow-none hover:bg-amber-100 dark:border-amber-700/80 dark:bg-amber-950/50 dark:text-amber-50",
};

const FALLBACK_BADGE =
  "border-slate-300/80 bg-slate-100 text-slate-900 shadow-none hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100";

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
