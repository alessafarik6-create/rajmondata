/**
 * Badging API (PWA / podporované prohlížeče) — ikona aplikace s počtem.
 * https://developer.mozilla.org/en-US/docs/Web/API/Badging_API
 */

export function applyAppBadgeCount(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (typeof nav.setAppBadge !== "function") {
    if (process.env.NODE_ENV === "development") {
      console.log("Applying app badge count", { count, supported: false });
    }
    return;
  }
  const n = Math.max(0, Math.min(99999, Math.floor(Number(count) || 0)));
  console.log("Applying app badge count", { count: n, supported: true });
  if (n <= 0) {
    void nav.clearAppBadge?.().catch(() => {});
    return;
  }
  void nav.setAppBadge(n).catch(() => {});
}

export function clearAppBadgeSafe(): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  if (typeof nav.clearAppBadge !== "function") return;
  void nav.clearAppBadge().catch(() => {});
}
