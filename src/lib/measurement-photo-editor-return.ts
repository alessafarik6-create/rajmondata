/** Bezpečný interní návratový path po uložení editoru foto zaměření (jen relativní /portal/…). */
export function sanitizeMeasurementEditorReturnTo(
  raw: string | null | undefined
): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.startsWith("/portal/")) return null;
  if (t.includes("//") || t.includes("..") || t.includes("?") || t.includes("#")) {
    return null;
  }
  return t;
}
