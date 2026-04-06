/**
 * Průběh zakázky pro klientský portál: procenta dokončení a obrázky ve slideru.
 * Pole na dokumentu zakázky: completionPercent, customerProgressImages.
 */

export type CustomerProgressImage = {
  id: string;
  url: string;
  storagePath: string;
  title?: string;
  description?: string;
  order?: number;
  /** Výchozí true pro zpětnou kompatibilitu. */
  visibleToCustomer?: boolean;
  createdAt?: unknown;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 0–100 včetně; chybějící hodnota → 0. */
export function normalizeCompletionPercent(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return clampInt(n, 0, 100);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/** Normalizace pole z Firestore; řazení podle order, pak createdAt. */
export function parseCustomerProgressImages(
  raw: unknown
): CustomerProgressImage[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomerProgressImage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = isNonEmptyString(o.id) ? o.id.trim() : "";
    const url = isNonEmptyString(o.url) ? o.url.trim() : "";
    const storagePath = isNonEmptyString(o.storagePath) ? o.storagePath.trim() : "";
    if (!id || !url || !storagePath) continue;
    const order =
      typeof o.order === "number" && Number.isFinite(o.order)
        ? o.order
        : typeof o.order === "string" && Number.isFinite(Number(o.order))
          ? Number(o.order)
          : i;
    const visible =
      o.visibleToCustomer === false || o.visibleToCustomer === "false" ? false : true;
    out.push({
      id,
      url,
      storagePath,
      title: isNonEmptyString(o.title) ? o.title.trim() : undefined,
      description: isNonEmptyString(o.description) ? o.description.trim() : undefined,
      order,
      visibleToCustomer: visible,
      createdAt: o.createdAt,
    });
  }
  out.sort((a, b) => {
    const od = (a.order ?? 0) - (b.order ?? 0);
    if (od !== 0) return od;
    return 0;
  });
  return out;
}

/** Obrázky viditelné v portálu zákazníka, seřazené. */
export function filterCustomerVisibleProgressImages(
  images: CustomerProgressImage[]
): CustomerProgressImage[] {
  return images.filter((img) => img.visibleToCustomer !== false);
}

export function newCustomerProgressImageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cpi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
