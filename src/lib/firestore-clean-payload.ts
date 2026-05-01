import {
  DocumentReference,
  FieldValue,
  Timestamp,
} from "firebase/firestore";

/**
 * Firestore nepřijímá `undefined` v datech. Rekurzivně odstraní undefined z objektů a z polí.
 * Zachová Firebase sentinel hodnoty (serverTimestamp, Timestamp, reference).
 */
export function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) {
    return value as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof FieldValue) {
    return value;
  }
  if (value instanceof DocumentReference) {
    return value;
  }
  if (Array.isArray(value)) {
    const next = value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined);
    return next as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cleaned = removeUndefinedDeep(v);
    if (cleaned !== undefined) {
      out[k] = cleaned;
    }
  }
  return out as T;
}
