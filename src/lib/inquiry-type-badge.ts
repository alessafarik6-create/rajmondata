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

/** Text ve štítku — prázdný zdroj → „Obecné“ (štítek vždy viditelný). */
export function getInquiryTypeBadgeLabel(type: string | null | undefined): string {
  const t = String(type ?? "").trim();
  return t || "Obecné";
}

/**
 * Celý vzhled štítku (bez shadcn Badge — eliminuje konflikty variant/cva).
 * `!` u bg a textu zajistí přepnutí i při kolizích s globálními styly.
 */
const INQUIRY_BADGE_SHELL =
  "inline-flex max-w-full shrink-0 items-center justify-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold leading-snug !text-black shadow-none";

export function getInquiryTypeBadgeClass(type: string | undefined | null): string {
  const kind = classifyInquiryType(type);
  switch (kind) {
    case "modulove_domy":
      return cn(
        INQUIRY_BADGE_SHELL,
        "!bg-blue-500 hover:!bg-blue-500 hover:!text-black"
      );
    case "pergoly":
      return cn(
        INQUIRY_BADGE_SHELL,
        "!bg-green-500 hover:!bg-green-500 hover:!text-black"
      );
    case "obecne":
    case "unknown":
    default:
      return cn(
        INQUIRY_BADGE_SHELL,
        "!bg-red-500 hover:!bg-red-500 hover:!text-black"
      );
  }
}
