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
