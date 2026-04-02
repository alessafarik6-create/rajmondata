"use client";

import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/components/pwa/pwa-install-context";

/**
 * Pruh instalace PWA — napojený na {@link usePwaInstall} (globální provider).
 *
 * - iOS: návod „Sdílet → Přidat na plochu“ dokud ne standalone.
 * - Chromium: tlačítko při `beforeinstallprompt`; po zavření promptu nebo bez události
 *   zůstane banner s textovým návodem (neskrývá se po jednom dismiss).
 * - Skrytí: pouze standalone / dokončená instalace (viz kontext), ne podle „už jednou zobrazeno“.
 */
export function PwaInstallBanner() {
  const {
    hydrated,
    isStandalone,
    isIOS,
    deferredPrompt,
    chromiumInstallDone,
    triggerInstall,
  } = usePwaInstall();

  if (!hydrated) return null;

  if (isStandalone) return null;

  const shellClass =
    "sticky top-0 z-[100] print:hidden border-b border-orange-200/80 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2.5 sm:px-6";

  if (isIOS) {
    return (
      <div
        className={`${shellClass} py-3 sm:py-3`}
        role="region"
        aria-label="Instalace aplikace na plochu"
      >
        <p className="text-center text-sm font-medium leading-relaxed text-slate-900 sm:text-base">
          <span className="font-semibold text-orange-800">iPhone / iPad:</span>{" "}
          pro instalaci otevřete nabídku{" "}
          <span className="whitespace-nowrap font-semibold">Sdílet</span> a zvolte{" "}
          <span className="whitespace-nowrap font-semibold">Přidat na plochu</span>.
        </p>
      </div>
    );
  }

  if (chromiumInstallDone) return null;

  const hasPrompt = deferredPrompt != null;

  return (
    <div className={shellClass} role="region" aria-label="Instalace aplikace">
      <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1 text-sm text-slate-800 sm:max-w-xl sm:text-[15px]">
          <p>
            Nainstalujte si aplikaci na plochu telefonu nebo počítače pro rychlejší přístup a
            pohodlnější práci.
          </p>
          {!hasPrompt ? (
            <p className="text-slate-700">
              V prohlížeči otevřete menu{" "}
              <span className="whitespace-nowrap font-semibold">(⋮ nebo ⋯)</span> a zvolte{" "}
              <span className="font-semibold">Instalovat aplikaci</span> /{" "}
              <span className="font-semibold">Nainstalovat aplikaci</span>, případně ikonu
              instalace v adresním řádku.
            </p>
          ) : null}
        </div>
        {hasPrompt ? (
          <Button
            type="button"
            size="lg"
            className="h-12 min-h-[48px] shrink-0 gap-2 bg-orange-500 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 sm:h-11 sm:min-h-0"
            onClick={() => void triggerInstall()}
          >
            <Download className="h-5 w-5 shrink-0" aria-hidden />
            Instaluj aplikaci
          </Button>
        ) : null}
      </div>
    </div>
  );
}
