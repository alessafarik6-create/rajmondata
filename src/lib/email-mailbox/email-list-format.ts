/** Zobrazitelné jméno z From hlavičky. */
export function formatEmailFromDisplay(from: string): string {
  const s = from.trim();
  const m = s.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  if (m?.[1]) return m[1].trim();
  const email = s.match(/<([^>]+)>/)?.[1] ?? s;
  if (email.includes("@")) return email.split("@")[0] ?? email;
  return s.slice(0, 80);
}

export function formatEmailListDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

export function normalizeEmailPriority(raw: string | null | undefined): "LOW" | "NORMAL" | "HIGH" | "URGENT" {
  const s = String(raw ?? "NORMAL").toUpperCase();
  if (s === "LOW") return "LOW";
  if (s === "HIGH") return "HIGH";
  if (s === "URGENT") return "URGENT";
  return "NORMAL";
}
