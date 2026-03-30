/**
 * Štítek typu poptávky — pouze UI. Celé třídy Tailwind jsou natvrdo v řetězcích (žádné `bg-${x}`).
 */

export type InquiryNormalizedKind = "modulove-domy" | "pergoly" | "obecne";

export function normalizeInquiryType(type?: string | null): InquiryNormalizedKind {
  const t = (type ?? "").toLowerCase().trim();
  if (t.includes("modul")) return "modulove-domy";
  if (t.includes("pergol")) return "pergoly";
  return "obecne";
}

/**
 * Kompletní className pro `<span>` štítku — vždy obsahuje `bg-blue-500` | `bg-green-500` | `bg-red-500`.
 */
export function getInquiryTypeChipClass(type?: string | null): string {
  const normalized = normalizeInquiryType(type);
  if (normalized === "modulove-domy") {
    return "inline-flex max-w-full min-w-0 shrink items-center truncate rounded-full px-2.5 py-1 text-sm font-medium bg-blue-500 text-black";
  }
  if (normalized === "pergoly") {
    return "inline-flex max-w-full min-w-0 shrink items-center truncate rounded-full px-2.5 py-1 text-sm font-medium bg-green-500 text-black";
  }
  return "inline-flex max-w-full min-w-0 shrink items-center truncate rounded-full px-2.5 py-1 text-sm font-medium bg-red-500 text-black";
}

export function getInquiryTypeLabel(type?: string | null): string {
  const normalized = normalizeInquiryType(type);
  if (normalized === "modulove-domy") return "Modulové domy";
  if (normalized === "pergoly") return "Pergoly";
  return "Obecné";
}

/**
 * Zdroj textu pro klasifikaci: hlavně `typ` z importu, jinak overlay (`typ_poptavky` / `typ`).
 */
export function resolveInquiryTypeRaw(
  row: { typ?: string },
  overlay?: { typ?: string; typ_poptavky?: string } | null
): string | undefined {
  const a = String(row?.typ ?? "").trim();
  if (a) return row.typ;
  const b = String(overlay?.typ_poptavky ?? "").trim();
  if (b) return overlay?.typ_poptavky;
  const c = String(overlay?.typ ?? "").trim();
  if (c) return overlay?.typ;
  return undefined;
}
