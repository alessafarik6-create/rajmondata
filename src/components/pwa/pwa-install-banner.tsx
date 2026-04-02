"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type BeforeInstallPromptEventLike,
  getIsLikelyIOS,
  getIsStandaloneDisplayMode,
  readPwaInstalledLocalFlag,
  registerPwaServiceWorker,
  writePwaInstalledLocalFlag,
} from "@/lib/pwa-install";

/**
 * Pruh s instalací PWA: Chromium — tlačítko + `beforeinstallprompt`;
 * iOS Safari — nápověda „Sdílet → Přidat na plochu“.
 * Skrytí: standalone / iOS standalone, po `appinstalled`, volitelně LS (ne iOS).
 */
export function PwaInstallBanner() {
  const [hydrated, setHydrated] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [deferred, setDeferred] =
    useState<BeforeInstallPromptEventLike | null>(null);
  const [installedLocal, setInstalledLocal] = useState(false);

  useEffect(() => {
    setHydrated(true);
    setStandalone(getIsStandaloneDisplayMode());
    setInstalledLocal(readPwaInstalledLocalFlag());
    registerPwaServiceWorker();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (standalone) {
      writePwaInstalledLocalFlag();
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEventLike);
    };

    const onAppInstalled = () => {
      setDeferred(null);
      writePwaInstalledLocalFlag();
      setInstalledLocal(true);
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

  const onInstallClick = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "dismissed") {
        /* tlačítko může zůstat — požadavek UX */
      }
      setDeferred(null);
    } catch {
      setDeferred(null);
    }
  }, [deferred]);

  if (!hydrated) return null;

  if (standalone) return null;

  const ios = getIsLikelyIOS();

  if (ios) {
    return (
      <div
        className="print:hidden border-b border-orange-200/80 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-3 sm:px-6"
        role="region"
        aria-label="Instalace aplikace na plochu"
      >
        <p className="text-center text-sm font-medium leading-relaxed text-slate-900 sm:text-base">
          <span className="font-semibold text-orange-800">iPhone / iPad:</span>{" "}
          pro instalaci otevřete nabídku{" "}
          <span className="whitespace-nowrap font-semibold">Sdílet</span> a zvolte{" "}
          <span className="whitespace-nowrap font-semibold">
            Přidat na plochu
          </span>
          .
        </p>
      </div>
    );
  }

  if (installedLocal && !deferred) return null;
  if (!deferred) return null;

  return (
    <div
      className="print:hidden border-b border-orange-200/80 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2.5 sm:px-6"
      role="region"
      aria-label="Instalace aplikace"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-slate-800 sm:max-w-xl sm:text-[15px]">
          Nainstalujte si aplikaci na plochu telefonu nebo počítače pro rychlejší
          přístup a pohodlnější práci.
        </p>
        <Button
          type="button"
          size="lg"
          className="h-12 min-h-[48px] shrink-0 gap-2 bg-orange-500 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 sm:h-11 sm:min-h-0"
          onClick={() => void onInstallClick()}
        >
          <Download className="h-5 w-5 shrink-0" aria-hidden />
          Instaluj aplikaci
        </Button>
      </div>
    </div>
  );
}
