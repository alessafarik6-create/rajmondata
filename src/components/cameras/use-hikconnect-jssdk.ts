"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    EZUIKit?: {
      EZUIKitPlayer: new (opts: Record<string, unknown>) => {
        stop: () => void;
        play: () => void;
        openSound: () => void;
        closeSound: () => void;
        fullScreen: () => void;
        cancelFullScreen: () => void;
        destroy?: () => void;
      };
    };
  }
}

const DEFAULT_SCRIPT = "/hikvision-jssdk/ezuikit.js";

export function useHikConnectJssdk() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.EZUIKit?.EZUIKitPlayer) {
      setReady(true);
      return;
    }
    const src =
      String(process.env.NEXT_PUBLIC_HIKCONNECT_JSSDK_URL ?? "").trim() || DEFAULT_SCRIPT;
    const existing = document.querySelector(`script[data-hik-jssdk="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => setReady(Boolean(window.EZUIKit?.EZUIKitPlayer)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.hikJssdk = src;
    script.onload = () => setReady(Boolean(window.EZUIKit?.EZUIKitPlayer));
    script.onerror = () =>
      setError(
        "Hik-Connect JSSDK není načteno. Nahrajte SDK z Hikvision Developer Kit do public/hikvision-jssdk/ nebo nastavte NEXT_PUBLIC_HIKCONNECT_JSSDK_URL."
      );
    document.head.appendChild(script);
  }, []);

  return { ready, error };
}
