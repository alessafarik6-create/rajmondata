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

/** Plné vyplnění (solid), bez viditelného obrysu — `border-transparent` + `bg-*-500` + `text-black`. */
const BADGE_BY_KIND: Record<
  Exclude<InquiryTypeKind, "unknown">,
  string
> = {
  modulove_domy:
    "border-transparent bg-blue-500 text-black shadow-none hover:bg-blue-500 hover:text-black dark:bg-blue-500 dark:text-black dark:hover:bg-blue-500",
  pergoly:
    "border-transparent bg-green-500 text-black shadow-none hover:bg-green-500 hover:text-black dark:bg-green-500 dark:text-black dark:hover:bg-green-500",
  obecne:
    "border-transparent bg-red-500 text-black shadow-none hover:bg-red-500 hover:text-black dark:bg-red-500 dark:text-black dark:hover:bg-red-500",
};

const FALLBACK_BADGE =
  "border-transparent bg-slate-400 text-black shadow-none hover:bg-slate-400 hover:text-black dark:bg-slate-400 dark:text-black dark:hover:bg-slate-400";

/**
 * Tailwind třídy pro `Badge` — plná barva pozadí, černý text, žádný outline (použijte s variant="default").
 */
export function getInquiryTypeBadgeClass(type: string | undefined | null): string {
  const kind = classifyInquiryType(type);
  if (kind === "unknown") {
    return cn("font-medium", FALLBACK_BADGE);
  }
  return cn("font-medium", BADGE_BY_KIND[kind]);
}
