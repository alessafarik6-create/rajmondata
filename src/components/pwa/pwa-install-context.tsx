"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type BeforeInstallPromptEventLike,
  getIsLikelyIOS,
  getIsStandaloneDisplayMode,
  readPwaInstalledLocalFlag,
  registerPwaServiceWorker,
  writePwaInstalledLocalFlag,
} from "@/lib/pwa-install";

/**
 * Sdílený stav PWA instalace napříč aplikací (bez závislosti na roli / route).
 * `beforeinstallprompt` se drží v React stavu — po `prompt()` se událost spotřebuje,
 * ale UI zůstane (fallback), dokud není standalone nebo `appinstalled`.
 *
 * localStorage klíč `rajmondata-pwa-appinstalled-v1` se používá jen po skutečné
 * instalaci (`appinstalled` / standalone), ne jako „už jsme ukázali prompt“.
 */
export type PwaInstallContextValue = {
  hydrated: boolean;
  /** display-mode standalone / navigator.standalone — skrýt vše */
  isStandalone: boolean;
  /** iPhone / iPad — návod místo beforeinstallprompt */
  isIOS: boolean;
  /**
   * Chromium: máme aktivní deferred prompt (tlačítko volá prompt()).
   * Po zamítnutí nebo po prompt() může být null, ale banner zůstane (fallback).
   */
  deferredPrompt: BeforeInstallPromptEventLike | null;
  /** Chromium: instalace dokončena (appinstalled nebo LS z minulé relace) — skrýt chromium část */
  chromiumInstallDone: boolean;
  triggerInstall: () => Promise<void>;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    throw new Error("usePwaInstall must be used within PwaInstallProvider");
  }
  return ctx;
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEventLike | null>(null);
  /** Pouze pro Chromium / desktop: skutečně nainstalováno (ne „viděl prompt“). */
  const [chromiumInstallDone, setChromiumInstallDone] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const s = getIsStandaloneDisplayMode();
    setStandalone(s);
    if (s) {
      writePwaInstalledLocalFlag();
    } else if (readPwaInstalledLocalFlag()) {
      /* Předchozí relace dokončila instalaci — v prohlížeči bez standalone nezobrazovat chromium CTA znovu. */
      setChromiumInstallDone(true);
    }
    registerPwaServiceWorker();
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    if (standalone) {
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEventLike);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      writePwaInstalledLocalFlag();
      setChromiumInstallDone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    const mq = window.matchMedia("(display-mode: standalone)");
    const onDisplayMode = () => {
      if (getIsStandaloneDisplayMode()) {
        setStandalone(true);
        writePwaInstalledLocalFlag();
      }
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onDisplayMode);
    } else {
      mq.addListener(onDisplayMode);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      if (typeof mq.removeEventListener === "function") {
        mq.removeEventListener("change", onDisplayMode);
      } else {
        mq.removeListener(onDisplayMode);
      }
    };
  }, [hydrated, standalone]);

  const triggerInstall = useCallback(async () => {
    const ev = deferredPrompt;
    if (!ev) return;
    try {
      await ev.prompt();
      await ev.userChoice;
      /* Jednorázová událost — po prompt() již nelze znovu použít; zobrazení přepne na fallback. */
    } catch {
      /* ignore */
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const isIOS = useMemo(() => (hydrated ? getIsLikelyIOS() : false), [hydrated]);

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      hydrated,
      isStandalone: standalone,
      isIOS,
      deferredPrompt,
      chromiumInstallDone,
      triggerInstall,
    }),
    [hydrated, standalone, isIOS, deferredPrompt, chromiumInstallDone, triggerInstall]
  );

  return (
    <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>
  );
}
