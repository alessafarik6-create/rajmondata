import { inspect } from "node:util";

/** Pro serverové logy: bez vyhození při circular strukturách. */
export function serializeUnknownForLog(value: unknown, maxLen = 16_000): string {
  if (value instanceof Error) {
    const parts: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    if ("cause" in value && value.cause !== undefined) {
      parts.cause = value.cause;
    }
    const s = inspect(parts, { depth: 8, breakLength: 120, maxArrayLength: 50 });
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "object") {
    try {
      const s = JSON.stringify(value);
      return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
    } catch {
      const s = inspect(value, { depth: 6, breakLength: 120, maxArrayLength: 30 });
      return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
    }
  }
  const s = String(value);
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

export function errorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message.trim() || err.name || "Error";
  const s = String(err).trim();
  return s || "Neznámá chyba";
}

export function errorStackFromUnknown(err: unknown): string | null {
  if (err instanceof Error && err.stack?.trim()) return err.stack.trim();
  return null;
}
