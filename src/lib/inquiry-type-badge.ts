/**
 * Štítek typu poptávky — pouze UI. Barvy z pevného pole Tailwind tříd (žádné `bg-${x}`).
 */

const INQUIRY_TYPE_HASH_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-red-500",
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-cyan-500",
] as const;

/**
 * Deterministická barva z řetězce — stejný text → stejná třída pozadí.
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return INQUIRY_TYPE_HASH_COLORS[Math.abs(hash) % INQUIRY_TYPE_HASH_COLORS.length];
}

/** Klíč pro hash: diakritika pryč, malá písmena, jedna mezera — „stejný“ typ ze zdroje → stejná barva. */
function hashKeyFromInquiryType(displayKey: string): string {
  return displayKey
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Jednoduchá normalizace (pro ostatní použití). */
export function normalizeInquiryType(type?: string | null): string {
  return (type ?? "").trim().toLowerCase();
}

const CHIP_BASE =
  "inline-flex max-w-full min-w-0 shrink items-center truncate rounded-full px-2.5 py-1 text-sm font-medium text-black";

/**
 * Barva pozadí z hashe textu typu; prázdný typ bereme jako „Obecné“ — vždy vyplněný štítek.
 */
export function getInquiryTypeChipClass(type?: string | null): string {
  const safe = (type ?? "").trim() || "Obecné";
  const key = hashKeyFromInquiryType(safe);
  const bg = stringToColor(key);
  return `${CHIP_BASE} ${bg}`;
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
