export function safeTime(value: unknown): number {
  try {
    if (value == null) return 0;
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof value === "string" || typeof value === "number") {
      const d = new Date(value);
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
      const secRaw = v["seconds"];
      const sec = typeof secRaw === "number" ? secRaw : Number(secRaw);
      if (Number.isFinite(sec) && sec > 0) return sec * 1000;
      const secLegacyRaw = v["_seconds"];
      const secLegacy =
        typeof secLegacyRaw === "number" ? secLegacyRaw : Number(secLegacyRaw);
      if (Number.isFinite(secLegacy) && secLegacy > 0) return secLegacy * 1000;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function formatDateSafe(value: unknown): string {
  try {
    const ms = safeTime(value);
    if (!ms) return "bez data";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "bez data";
    return d.toLocaleString("cs-CZ", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "bez data";
  }
}

/** Např. `10.05.2026 14:22` (pevné nuly u data i času). */
export function formatCsDateTimeDot(value: unknown): string {
  try {
    const ms = safeTime(value);
    if (!ms) return "bez data";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "bez data";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  } catch {
    return "bez data";
  }
}

