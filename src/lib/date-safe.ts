/** Nevyřešený zápis `serverTimestamp()` v lokálním snapshotu — není použitelné pro zobrazení. */
export function isFirestoreServerTimestampPlaceholder(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v._methodName === "serverTimestamp") return true;
  const delegate = v._delegate as Record<string, unknown> | undefined;
  if (delegate?._methodName === "serverTimestamp") return true;
  return false;
}

export function safeTime(value: unknown): number {
  try {
    if (value == null) return 0;
    if (isFirestoreServerTimestampPlaceholder(value)) return 0;
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return 0;
      // sekundy vs milisekundy (Firestore seconds ~ 1e9, ms ~ 1e12)
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      const asNum = Number(trimmed);
      if (Number.isFinite(asNum) && asNum > 0) {
        return asNum < 1e12 ? asNum * 1000 : asNum;
      }
      const d = new Date(trimmed);
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof value === "object") {
      const v = value as Record<string, unknown>;
      const toMillis = v["toMillis"];
      if (typeof toMillis === "function") {
        const ms = (toMillis as () => number)();
        return Number.isFinite(ms) ? ms : 0;
      }
      const toDate = v["toDate"];
      if (typeof toDate === "function") {
        const d = (toDate as () => Date)();
        const ms = d?.getTime?.();
        return typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
      }
      const secRaw = v["seconds"] ?? v["_seconds"];
      const sec = typeof secRaw === "number" ? secRaw : Number(secRaw);
      const nanoRaw = v["nanoseconds"] ?? v["_nanoseconds"];
      const nano = typeof nanoRaw === "number" ? nanoRaw : Number(nanoRaw);
      if (Number.isFinite(sec) && sec > 0) {
        const extra = Number.isFinite(nano) ? Math.floor(nano / 1e6) : 0;
        return sec * 1000 + extra;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

export const MESSAGE_DATE_UNKNOWN = "Neznámé datum";

/** Formát `03.06.2026 15:28` z libovolné hodnoty času. */
export function formatMessageDateFromValue(value: unknown): string {
  try {
    const ms = safeTime(value);
    if (!ms) return MESSAGE_DATE_UNKNOWN;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return MESSAGE_DATE_UNKNOWN;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  } catch {
    return MESSAGE_DATE_UNKNOWN;
  }
}

export function formatDateSafe(value: unknown): string {
  try {
    const ms = safeTime(value);
    if (!ms) return MESSAGE_DATE_UNKNOWN;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return MESSAGE_DATE_UNKNOWN;
    return d.toLocaleString("cs-CZ", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return MESSAGE_DATE_UNKNOWN;
  }
}

/** Např. `03.06.2026 15:28` (pevné nuly u data i času). */
export function formatCsDateTimeDot(value: unknown): string {
  return formatMessageDateFromValue(value);
}

