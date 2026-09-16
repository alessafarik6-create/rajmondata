import type { Timestamp } from "firebase-admin/firestore";

/** Převod Firestore dat na JSON (Timestamp → ISO, GeoPoint → objekt). */
export function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => serializeFirestoreValue(v));
  }
  const maybeTs = value as Timestamp;
  if (typeof maybeTs.toDate === "function") {
    try {
      return maybeTs.toDate().toISOString();
    } catch {
      return null;
    }
  }
  const geo = value as { latitude?: number; longitude?: number };
  if (
    typeof geo.latitude === "number" &&
    typeof geo.longitude === "number" &&
    Object.keys(value as object).length === 2
  ) {
    return { latitude: geo.latitude, longitude: geo.longitude };
  }
  const ref = value as { path?: string };
  if (typeof ref.path === "string" && ref.path.includes("/")) {
    return { _ref: ref.path };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serializeFirestoreValue(v);
  }
  return out;
}

export function deserializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => deserializeFirestoreValue(v));
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj._ref === "string") {
    return { _ref: obj._ref };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = deserializeFirestoreValue(v);
  }
  return out;
}
