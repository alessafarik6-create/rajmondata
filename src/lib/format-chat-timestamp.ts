import {
  isFirestoreServerTimestampPlaceholder,
  safeTime,
} from "@/lib/date-safe";

/** Vrací null, pokud čas ještě není k dispozici (serverTimestamp placeholder). */
export function formatChatTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (isFirestoreServerTimestampPlaceholder(value)) return null;
  const ms = safeTime(value);
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const datePart = `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
  return `${datePart} · ${hh}:${min}`;
}

/** Pro UI bubliny — pending → „Odesílám…“, jinak formátovaný čas nebo pomlčka. */
export function formatChatTimestampDisplay(value: unknown): string {
  const formatted = formatChatTimestamp(value);
  if (formatted) return formatted;
  if (value != null && isFirestoreServerTimestampPlaceholder(value)) {
    return "Odesílám…";
  }
  if (value == null) return "Odesílám…";
  const ms = safeTime(value);
  if (!ms) return "Odesílám…";
  return "—";
}
