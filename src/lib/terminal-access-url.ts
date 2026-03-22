/**
 * Veřejná cesta terminálu (root aplikace, ne pod /portal).
 * Používej vždy absolutní cestu od kořene: `/terminal-access/{token}`.
 */
export const TERMINAL_ACCESS_PATH = "/terminal-access";

export function getTerminalAccessPath(token: string): string {
  const t = token.trim();
  if (!t) return TERMINAL_ACCESS_PATH;
  return `${TERMINAL_ACCESS_PATH}/${encodeURIComponent(t)}`;
}

/** Plná URL v prohlížeči (kopírování, QR). */
export function getTerminalAccessAbsoluteUrl(token: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${getTerminalAccessPath(token)}`;
}
