"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, PencilRuler } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUser } from "@/firebase";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import { ExternalModuleLaunchButton } from "@/components/portal/external-module-launch-button";

function isCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

export default function ExternalModuleLaunchPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const raw = String(params.moduleCode ?? "").trim();
  const moduleCode = isCode(raw) ? raw : null;
  const auto = searchParams.get("auto") === "1";
  const { user, isUserLoading } = useUser();
  const autoStarted = useRef(false);

  const title = useMemo(() => {
    if (moduleCode === "rajmondata_editor") return "RAJMONDATA EDITOR";
    return moduleCode ?? "Modul";
  }, [moduleCode]);

  useEffect(() => {
    if (!auto || autoStarted.current || !moduleCode || !user) return;
    autoStarted.current = true;
    const t = window.setTimeout(() => {
      document.getElementById("external-module-launch-btn")?.click();
    }, 150);
    return () => window.clearTimeout(t);
  }, [auto, moduleCode, user]);

  if (!moduleCode) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Neplatný modul.</p>
        <Button variant="link" asChild>
          <Link href="/portal/dashboard">Zpět na přehled</Link>
        </Button>
      </div>
    );
  }

  if (isUserLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6 space-y-2">
        <p>Pro spuštění modulu se přihlaste.</p>
        <Button asChild>
          <Link href="/login">Přihlásit se</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <PencilRuler className="h-8 w-8 text-orange-500 shrink-0" />
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Bezpečné spuštění přes Firebase SSO a jednorázový launch ticket.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {auto ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Spouštím editor…
            </p>
          ) : null}
          <ExternalModuleLaunchButton
            moduleCode={moduleCode}
            buttonId="external-module-launch-btn"
            label={
              moduleCode === "rajmondata_editor"
                ? "Spustit RAJMONDATA EDITOR"
                : `Spustit ${title}`
            }
          />
          <p className="text-xs text-muted-foreground">
            Editor se otevře v nové kartě. Nepoužíváme trvalé tokeny v adrese URL — pouze jednorázový
            ticket.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/portal/moje-moduly">Moje moduly</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
