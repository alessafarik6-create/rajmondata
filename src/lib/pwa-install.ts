/** Klíč localStorage po úspěšné události appinstalled (Android / desktop Chromium). */
export const PWA_INSTALLED_LOCAL_KEY = "rajmondata-pwa-appinstalled-v1";

export type BeforeInstallPromptEventLike = Event & {
  preventDefault: () => void;
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function getIsStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
    if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  } catch {
    /* empty */
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return false;
}

/** iPhone / iPad (včetně iPadOS jako MacIntel + touch). */
export function getIsLikelyIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return (
    window.navigator.platform === "MacIntel" &&
    window.navigator.maxTouchPoints > 1
  );
}

export function readPwaInstalledLocalFlag(): boolean {
  try {
    return window.localStorage.getItem(PWA_INSTALLED_LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePwaInstalledLocalFlag(): void {
  try {
    window.localStorage.setItem(PWA_INSTALLED_LOCAL_KEY, "1");
  } catch {
    /* empty */
  }
}

export function registerPwaServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    /* např. ne-HTTPS nebo blokace SW */
  });
}
