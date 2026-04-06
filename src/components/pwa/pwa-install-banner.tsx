"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall } from "@/components/pwa/pwa-install-context";
import {
  readPwaBannerSessionDismiss,
  writePwaBannerSessionDismiss,
} from "@/lib/pwa-install";

const BANNER_COPY =
  "Nainstalujte si aplikaci na plochu telefonu nebo počítače pro rychlejší a pohodlnější přístup.";

/**
 * Instalační lišta PWA — jen v layoutu po přihlášení (portál / admin).
 *
 * - Trvalé skrytí: standalone / `navigator.standalone` / `appinstalled` / dokončená instalace (viz kontext).
 * - „Zatím nechci instalovat“: jen pro aktuální přihlášení (`sessionStorage`), po odhlášení znovu.
 * - Chromium: `beforeinstallprompt` → `prompt()`; odmítnutí promptu = stejné session skrytí jako tlačítko.
 * - iOS: návod v dialogu (bez systémového install promptu).
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

  const [sessionDismissed, setSessionDismissed] = useState(false);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [chromiumHelpOpen, setChromiumHelpOpen] = useState(false);

  const syncDismissFromStorage = useCallback(() => {
    setSessionDismissed(readPwaBannerSessionDismiss());
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    syncDismissFromStorage();
  }, [hydrated, syncDismissFromStorage]);

  useEffect(() => {
    const onRefresh = () => syncDismissFromStorage();
    window.addEventListener("rajmondata-pwa-banner-refresh", onRefresh);
    return () => window.removeEventListener("rajmondata-pwa-banner-refresh", onRefresh);
  }, [syncDismissFromStorage]);

  const dismissForSession = useCallback(() => {
    writePwaBannerSessionDismiss();
    setSessionDismissed(true);
  }, []);

  if (!hydrated) return null;
  if (isStandalone) return null;
  if (sessionDismissed) return null;

  const shellClass =
    "sticky top-0 z-[100] print:hidden border-b border-orange-200/80 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2.5 sm:px-6 dark:border-orange-900/50 dark:from-orange-950/40 dark:to-amber-950/30";

  const buttonRowClass =
    "flex w-full flex-col gap-2 sm:w-auto sm:flex-shrink-0 sm:flex-row sm:items-center sm:justify-end sm:gap-2";

  if (isIOS) {
    return (
      <>
        <div
          className={shellClass}
          role="region"
          aria-label="Instalace aplikace na plochu"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium leading-relaxed text-slate-900 dark:text-slate-100 sm:max-w-2xl sm:text-[15px]">
              {BANNER_COPY}
            </p>
            <div className={buttonRowClass}>
              <Button
                type="button"
                size="lg"
                className="h-12 min-h-[48px] w-full gap-2 bg-orange-500 px-4 text-base font-semibold text-white shadow-sm hover:bg-orange-600 sm:h-11 sm:min-h-0 sm:w-auto sm:px-5"
                onClick={() => setIosHelpOpen(true)}
              >
                <Download className="h-5 w-5 shrink-0" aria-hidden />
                Nainstaluj si aplikaci
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-12 min-h-[48px] w-full border-slate-300 bg-white/90 text-base font-semibold text-slate-900 hover:bg-white dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-100 sm:h-11 sm:min-h-0 sm:w-auto"
                onClick={dismissForSession}
              >
                Zatím nechci instalovat
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={iosHelpOpen} onOpenChange={setIosHelpOpen}>
          <DialogContent className="max-w-md border-slate-200 dark:border-slate-700">
            <DialogHeader>
              <DialogTitle>Přidání na plochu (iPhone / iPad)</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-left text-sm text-muted-foreground">
                  <ol className="list-decimal space-y-2 pl-4">
                    <li>Otevřete tuto stránku v Safari.</li>
                    <li>
                      Klepněte na tlačítko <span className="font-semibold text-foreground">Sdílet</span>{" "}
                      (čtverec se šipkou nahoru).
                    </li>
                    <li>
                      Zvolte <span className="font-semibold text-foreground">Přidat na plochu</span> a
                      potvrďte.
                    </li>
                  </ol>
                  <p className="text-xs">
                    V jiných prohlížečích na iOS může být instalace omezená — použijte Safari.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (chromiumInstallDone) return null;

  const hasPrompt = deferredPrompt != null;

  return (
    <>
      <div className={shellClass} role="region" aria-label="Instalace aplikace">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 text-sm text-slate-800 dark:text-slate-200 sm:max-w-2xl sm:text-[15px]">
            <p>{BANNER_COPY}</p>
            {!hasPrompt ? (
              <p className="text-xs text-slate-600 dark:text-slate-400 sm:text-sm">
                V prohlížeči otevřete menu (⋮ nebo ⋯) a zvolte instalaci aplikace, případně ikonu v adresním
                řádku — nebo klepněte na „Nainstaluj si aplikaci“ pro návod.
              </p>
            ) : null}
          </div>
          <div className={buttonRowClass}>
            <Button
              type="button"
              size="lg"
              className="h-12 min-h-[48px] w-full gap-2 bg-orange-500 px-4 text-base font-semibold text-white shadow-sm hover:bg-orange-600 sm:h-11 sm:min-h-0 sm:w-auto sm:px-5"
              onClick={() => {
                if (hasPrompt) {
                  void triggerInstall();
                } else {
                  setChromiumHelpOpen(true);
                }
              }}
            >
              <Download className="h-5 w-5 shrink-0" aria-hidden />
              Nainstaluj si aplikaci
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-12 min-h-[48px] w-full border-slate-300 bg-white/90 text-base font-semibold text-slate-900 hover:bg-white dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-100 sm:h-11 sm:min-h-0 sm:w-auto"
              onClick={dismissForSession}
            >
              Zatím nechci instalovat
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={chromiumHelpOpen} onOpenChange={setChromiumHelpOpen}>
        <DialogContent className="max-w-md border-slate-200 dark:border-slate-700">
          <DialogHeader>
            <DialogTitle>Instalace v prohlížeči</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-left text-sm text-muted-foreground">
                <p>
                  V <span className="font-medium text-foreground">Google Chrome</span> nebo{" "}
                  <span className="font-medium text-foreground">Microsoft Edge</span> otevřete menu{" "}
                  <span className="whitespace-nowrap">(⋮ nebo ⋯)</span> a zvolte{" "}
                  <span className="font-semibold text-foreground">Instalovat aplikaci</span> /{" "}
                  <span className="font-semibold text-foreground">Nainstalovat aplikaci</span>.
                </p>
                <p>
                  Na počítači může být v adresním řádku ikona instalace (+ nebo monitor se šipkou).
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Alias podle zadání (jedna sdílená komponenta). */
export const InstallAppBanner = PwaInstallBanner;
