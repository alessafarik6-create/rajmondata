/**
 * Štítek typu poptávky — pouze UI. Třídy Tailwind jsou vždy celé řetězce v kódu (žádné `bg-${x}`).
 */

/** Jednoduchá normalizace (pro label / zobrazení). */
export function normalizeInquiryType(type?: string | null): string {
  return (type ?? "").trim().toLowerCase();
}

/** Pro porovnání klíčových slov: diakritika pryč, malá písmena. */
function inquiryTypeMatchKey(type?: string | null): string {
  return String(type ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const CHIP_BASE =
  "inline-flex max-w-full min-w-0 shrink items-center truncate rounded-full px-2.5 py-1 text-sm font-medium text-black";

/**
 * Barva podle obsahu textu z importu. Neznámý / prázdný typ → stále viditelný neutrální štítek.
 */
export function getInquiryTypeChipClass(type?: string | null): string {
  const t = inquiryTypeMatchKey(type);
  if (!t) {
    return `${CHIP_BASE} bg-slate-300`;
  }
  if (t.includes("modul")) {
    return `${CHIP_BASE} bg-blue-500`;
  }
  if (t.includes("mont")) {
    return `${CHIP_BASE} bg-indigo-500`;
  }
  if (t.includes("zahrad")) {
    return `${CHIP_BASE} bg-green-500`;
  }
  if (t.includes("pergol")) {
    return `${CHIP_BASE} bg-emerald-500`;
  }
  if (t.includes("obecn")) {
    return `${CHIP_BASE} bg-red-500`;
  }
  return `${CHIP_BASE} bg-slate-300`;
}

/** Původní text z importu; prázdné → „Obecné“. */
export function getInquiryTypeLabel(type?: string | null): string {
  const trimmed = (type ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Obecné";
}

export type InquiryTypeOverlayFields = {
  typ?: string;
  typ_poptavky?: string;
  type?: string;
  inquiryType?: string;
  category?: string;
  productType?: string;
  serviceType?: string;
  typPoptavky?: string;
  kategorie?: string;
};

/**
 * Zdroj řetězce pro štítek: `typ` z řádku importu, jinak běžná pole z overlaye / rozšířených zdrojů.
 */
export function resolveInquiryTypeRaw(
  row: { typ?: string },
  overlay?: InquiryTypeOverlayFields | null
): string | undefined {
  const fromRow = String(row?.typ ?? "").trim();
  if (fromRow) return fromRow;

  if (!overlay || typeof overlay !== "object") return undefined;

  const keys = [
    "typ_poptavky",
    "typPoptavky",
    "typ",
    "type",
    "inquiryType",
    "category",
    "kategorie",
    "productType",
    "serviceType",
  ] as const;
  for (const k of keys) {
    const v = overlay[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}
