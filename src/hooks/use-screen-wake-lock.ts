"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useScreenWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const [supported, setSupported] = useState(false);
  const [held, setHeld] = useState(false);
  const [showUnsupportedHint, setShowUnsupportedHint] = useState(false);

  const release = useCallback(async () => {
    try {
      await lockRef.current?.release();
    } catch {
      /* ignore */
    }
    lockRef.current = null;
    setHeld(false);
  }, []);

  const acquire = useCallback(async () => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setSupported(false);
      setShowUnsupportedHint(true);
      return;
    }
    setSupported(true);
    if (document.visibilityState !== "visible") return;
    try {
      await release();
      lockRef.current = await navigator.wakeLock.request("screen");
      setHeld(true);
      lockRef.current.addEventListener("release", () => setHeld(false), { once: true });
    } catch {
      setHeld(false);
    }
  }, [active, release]);

  useEffect(() => {
    if (!active) {
      void release();
      setShowUnsupportedHint(false);
      return;
    }
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible" && active) {
        void acquire();
      } else {
        void release();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void release();
    };
  }, [active, acquire, release]);

  return { supported, held, showUnsupportedHint, reacquire: acquire };
}
