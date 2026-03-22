/**
 * Náhodný hex token pro trvalý odkaz terminálu (tablet).
 * 24 bajtů = 48 hex znaků (v rozsahu 32–128 znaků očekávaném API).
 */
export function generateTerminalAccessToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
