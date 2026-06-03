/**
 * Bezpečná konverze hodnoty na pole (null, undefined, objekt z Firestore, legacy data).
 */
export function toArraySafe<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>) as T[];
  }
  return [];
}
