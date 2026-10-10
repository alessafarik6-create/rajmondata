export type SatelitniListMeta = {
  count?: number;
  has_more?: boolean;
  next_cursor?: string | null;
};

const LIST_KEYS = ["data", "items", "vehicles", "results", "records"] as const;

/** Sloučí JSON:API / obal `{ id, attributes }` do plochého objektu. */
export function normalizeSatelitniRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const attrs = obj.attributes;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    const flat: Record<string, unknown> = { ...(attrs as Record<string, unknown>) };
    if (obj.id != null && flat.id == null) flat.id = obj.id;
    if (obj.type != null && flat.type == null) flat.type = obj.type;
    return flat;
  }
  return obj;
}

export function extractListItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload.map((row) => normalizeSatelitniRecord(row) as T);
  }
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  for (const key of LIST_KEYS) {
    const val = root[key];
    if (Array.isArray(val)) {
      return val.map((row) => normalizeSatelitniRecord(row) as T);
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      for (const innerKey of LIST_KEYS) {
        const inner = nested[innerKey];
        if (Array.isArray(inner)) {
          return inner.map((row) => normalizeSatelitniRecord(row) as T);
        }
      }
    }
  }
  return [];
}

export function extractMeta(payload: unknown): SatelitniListMeta {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const root = payload as Record<string, unknown>;
  if (root.meta && typeof root.meta === "object") {
    return root.meta as SatelitniListMeta;
  }
  for (const key of LIST_KEYS) {
    const val = root[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      if (nested.meta && typeof nested.meta === "object") {
        return nested.meta as SatelitniListMeta;
      }
    }
  }
  return {};
}

/** Jednotlivý zdroj (např. latest position) může být v `data`. */
export function unwrapSatelitniResource<T extends Record<string, unknown>>(payload: unknown): T {
  if (!payload || typeof payload !== "object") return {} as T;
  const root = payload as Record<string, unknown>;
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    return normalizeSatelitniRecord(root.data) as T;
  }
  return normalizeSatelitniRecord(root) as T;
}

/** Bezpečný náhled struktury odpovědi pro diagnostiku (bez citlivých dat). */
export function describePayloadShape(payload: unknown): string {
  if (Array.isArray(payload)) return `pole[${payload.length}]`;
  if (!payload || typeof payload !== "object") return typeof payload;
  const root = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(root).slice(0, 12)) {
    const v = root[k];
    if (Array.isArray(v)) parts.push(`${k}:pole[${v.length}]`);
    else if (v && typeof v === "object") parts.push(`${k}:objekt`);
    else parts.push(`${k}:${typeof v}`);
  }
  return parts.join(", ") || "prázdný objekt";
}
