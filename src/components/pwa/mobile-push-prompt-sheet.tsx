"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { usePortalNotificationsSafe } from "@/components/portal/portal-notifications-context";
import {
  isPushPromptTargetDevice,
  PUSH_PROMPT_SESSION_DISMISS_KEY,
  probeLocalPushSubscription,
} from "@/lib/web-push-client";
import { useToast } from "@/hooks/use-toast";

type Props = {
  /** Po přihlášení a načtení kontextu uživatele. */
  enabled: boolean;
};

/**
 * Nenásilná výzva k push na mobilu / PWA — max jednou za session, znovu po novém otevření aplikace.
 */
export function MobilePushPromptSheet({ enabled }: Props) {
  const { toast } = useToast();
  const {
    pushSupported,
    pushDiagnostics,
    registerWebPush,
    refreshPushDiagnostics,
  } = usePortalNotificationsSafe();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const evaluatedRef = useRef(false);

  const dismissForSession = useCallback(() => {
    try {
      sessionStorage.setItem(PUSH_PROMPT_SESSION_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled || evaluatedRef.current) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const evaluate = async () => {
      try {
        if (sessionStorage.getItem(PUSH_PROMPT_SESSION_DISMISS_KEY) === "1") {
          evaluatedRef.current = true;
          return;
        }
      } catch {
        /* ignore */
      }

      if (!isPushPromptTargetDevice()) {
        evaluatedRef.current = true;
        return;
      }

      if (
        !pushSupported ||
        typeof Notification === "undefined" ||
        !("serviceWorker" in navigator)
      ) {
        evaluatedRef.current = true;
        return;
      }

      if (!pushDiagnostics.vapidConfigured) {
        return;
      }

      const localActive =
        pushDiagnostics.localDevicePushActive || (await probeLocalPushSubscription());
      if (localActive) {
        evaluatedRef.current = true;
        return;
      }

      if (Notification.permission === "granted") {
        const subActive = await probeLocalPushSubscription();
        if (subActive) {
          evaluatedRef.current = true;
          void refreshPushDiagnostics();
          return;
        }
      }

      if (!cancelled) {
        evaluatedRef.current = true;
        setOpen(true);
      }
    };

    void evaluate();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    pushSupported,
    pushDiagnostics.vapidConfigured,
    pushDiagnostics.localDevicePushActive,
    refreshPushDiagnostics,
  ]);

  const permission =
    typeof Notification !== "undefined" ? Notification.permission : ("unsupported" as const);
  const denied = permission === "denied";
  const iosInstall = pushDiagnostics.iosHomeScreenHint;

  const onActivate = async () => {
    if (denied || iosInstall) return;
    setBusy(true);
    try {
      const result = await registerWebPush();
      if (result.ok) {
        toast({
          title: "Push upozornění byla aktivována",
          description: result.message,
        });
        dismissForSession();
        await refreshPushDiagnostics();
      } else {
        console.error("[MobilePushPrompt] registerWebPush failed:", result.message);
        toast({
          title: "Push upozornění se nepodařilo aktivovat",
          description: result.message,
          variant: "destructive",
        });
        dismissForSession();
      }
    } catch (e) {
      console.error("[MobilePushPrompt] registerWebPush error", e);
      toast({
        title: "Push upozornění se nepodařilo aktivovat",
        description: "Zkuste to znovu v Nastavení oznámení.",
        variant: "destructive",
      });
      dismissForSession();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissForSession();
        else setOpen(true);
      }}
    >
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 pt-6 max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left space-y-2">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5 text-primary" aria-hidden />
            Zapnout upozornění
          </SheetTitle>
          <SheetDescription className="text-sm leading-relaxed text-foreground/80">
            {iosInstall ? (
              <>
                Pro push upozornění nainstalujte RAJMONDATA na plochu (Přidat na Domovskou obrazovku)
                a otevřete aplikaci z ikony. Na iOS 16.4+ pak lze oznámení povolit.
              </>
            ) : denied ? (
              <>
                Upozornění jsou v prohlížeči zakázaná. Povolte je v nastavení webu / aplikace pro
                tuto stránku.
              </>
            ) : (
              <>
                Dostávejte upozornění na nové zprávy, schůzky, montáže, změny zakázek a další
                důležité události.
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {showHelp && denied ? (
          <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs space-y-2 text-muted-foreground">
            <p className="font-medium text-foreground">Jak povolit oznámení</p>
            <p>
              <strong>Chrome (Android):</strong> ikona zámku / i v adresním řádku → Oznámení → Povolit.
            </p>
            <p>
              <strong>Safari (iOS PWA):</strong> Nastavení → Oznámení → najděte RAJMONDATA na ploše.
            </p>
            <p>
              Podrobnosti a test push najdete v{" "}
              <Link href="/portal/notifications" className="text-primary underline" onClick={dismissForSession}>
                Oznámeních
              </Link>
              .
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {denied ? (
            <Button type="button" variant="default" className="w-full sm:w-auto" onClick={() => setShowHelp((v) => !v)}>
              Jak povolit
            </Button>
          ) : iosInstall ? (
            <Button type="button" variant="default" className="w-full sm:w-auto" asChild>
              <Link href="/portal/notifications" onClick={dismissForSession}>
                Návod k instalaci
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => void onActivate()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Zapnout upozornění
            </Button>
          )}
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={dismissForSession}>
            Později
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
