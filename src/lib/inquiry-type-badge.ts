/**
 * Štítek typu poptávky — pouze UI. Barvy jen z pevného pole (žádné `bg-${x}`).
 * POZN.: tailwind `content` musí zahrnovat `src/lib`, jinak se tyto třídy nevygenerují.
 */

export const INQUIRY_TYPE_COLORS = [
  "!bg-blue-500 !text-black",
  "!bg-green-500 !text-black",
  "!bg-red-500 !text-black",
  "!bg-indigo-500 !text-black",
  "!bg-emerald-500 !text-black",
  "!bg-orange-500 !text-black",
  "!bg-purple-500 !text-black",
  "!bg-pink-500 !text-black",
  "!bg-cyan-500 !text-black",
  "!bg-teal-500 !text-black",
  "!bg-lime-500 !text-black",
  "!bg-rose-500 !text-black",
] as const;

/** Prázdný / jen mezery → stejný klíč jako „Obecné“. */
export function normalizeInquiryType(type?: string | null): string {
  const raw = String(type ?? "").trim();
  return (raw || "Obecné").toLowerCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Jedna věta tříd — barva vždy z pole INQUIRY_TYPE_COLORS. */
export function getInquiryTypeChipClass(type?: string | null): string {
  const normalized = normalizeInquiryType(type);
  const color =
    INQUIRY_TYPE_COLORS[hashString(normalized) % INQUIRY_TYPE_COLORS.length];
  return `inline-flex max-w-full min-w-0 shrink items-center truncate rounded-full px-2.5 py-1 text-sm font-medium ${color}`;
}

export function getInquiryTypeLabel(type?: string | null): string {
  const raw = String(type ?? "").trim();
  return raw.length > 0 ? raw : "Obecné";
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
