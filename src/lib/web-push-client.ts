/**
 * Klient: převod VAPID public key pro PushManager.subscribe.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const PUSH_PROMPT_SESSION_DISMISS_KEY = "rajmondata.pushPromptDismissed";

/** Mobil / PWA kontext — ne široký desktop bez standalone. */
export function isPushPromptTargetDevice(): boolean {
  if (typeof window === "undefined") return false;

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return true;

  const { platform } = detectPushPlatform();
  if (platform === "iOS" || platform === "Android") return true;

  const mobileViewport = window.matchMedia("(max-width: 767px)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const touch =
    (typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0) ||
    coarsePointer;

  return mobileViewport && touch;
}

/** Push aktivní na tomto zařízení (permission + SW subscription). */
export async function probeLocalPushSubscription(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration("/sw.js")) ??
      (await navigator.serviceWorker.ready);
    const sub = await reg.pushManager.getSubscription();
    return sub != null;
  } catch {
    return false;
  }
}

export function detectPushPlatform(): { platform: string; deviceName: string; iosHomeScreenHint: boolean } {
  if (typeof window === "undefined") {
    return { platform: "unknown", deviceName: "—", iosHomeScreenHint: false };
  }
  const ua = navigator.userAgent;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deviceName = "Prohlížeč";
  if (ua.includes("Edg/")) deviceName = "Edge";
  else if (ua.includes("Chrome/")) deviceName = "Chrome";
  else if (ua.includes("Firefox/")) deviceName = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome")) deviceName = "Safari";
  const platform = isIOS ? "iOS" : ua.includes("Android") ? "Android" : standalone ? "PWA" : "Desktop";
  return {
    platform,
    deviceName,
    iosHomeScreenHint: isIOS && !standalone,
  };
}
