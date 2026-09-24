import {
  isFirestoreServerTimestampPlaceholder,
  safeTime,
} from "@/lib/date-safe";

/** Normalizuje timestamp zprávy (Firestore / ISO / ms). */
export function normalizeMessageDate(value: unknown): Date | null {
  if (value == null || isFirestoreServerTimestampPlaceholder(value)) return null;
  const ms = safeTime(value);
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Řádek autor · datum · čas pro chat bubliny. Dnes jen HH:mm, starší dny včetně data. */
export function formatMessageAuthorDateTime(value: unknown): string {
  const d = normalizeMessageDate(value);
  if (!d) {
    if (value != null && isFirestoreServerTimestampPlaceholder(value)) return "Odesílám…";
    return "Odesílám…";
  }
  const timePart = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  if (day === today) return timePart;
  const datePart = `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
  return `${datePart} · ${timePart}`;
}

/** Vrací null, pokud čas ještě není k dispozici (serverTimestamp placeholder). */
export function formatChatTimestamp(value: unknown): string | null {
  const d = normalizeMessageDate(value);
  if (!d) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  if (startOfDay(d) === startOfDay(new Date())) return `${hh}:${min}`;
  const datePart = `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
  return `${datePart} · ${hh}:${min}`;
}

/** Oddělovač dnů v chatu (lokální timezone). */
export function formatChatDaySeparator(value: unknown): string | null {
  if (value == null || isFirestoreServerTimestampPlaceholder(value)) return null;
  const ms = safeTime(value);
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays === 0) return "Dnes";
  if (diffDays === 1) return "Včera";
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
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
