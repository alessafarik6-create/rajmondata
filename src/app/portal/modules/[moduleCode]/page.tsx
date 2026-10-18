"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, PencilRuler } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUser } from "@/firebase";
import { resolvePlatformModuleFromRouteParam } from "@/lib/platform-module-route";
import { useExternalModuleLaunch } from "@/hooks/use-external-module-launch";

export default function ExternalModuleLaunchPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const raw = String(params.moduleCode ?? "").trim();
  const moduleCode = resolvePlatformModuleFromRouteParam(raw);
  const auto = searchParams.get("auto") === "1";
  const { user, isUserLoading } = useUser();
  const autoAttempted = useRef(false);
  const { phase, error, launch, reset, isLoading } = useExternalModuleLaunch(
    moduleCode ?? "rajmondata_editor"
  );

  const title = useMemo(() => {
    if (moduleCode === "rajmondata_editor") return "RAJMONDATA EDITOR";
    return moduleCode ?? "Modul";
  }, [moduleCode]);

  useEffect(() => {
    if (!auto || autoAttempted.current || !moduleCode || !user || isUserLoading) return;
    autoAttempted.current = true;
    void launch(user, { openInNewTab: true });
  }, [auto, moduleCode, user, isUserLoading, launch]);

  if (!moduleCode) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm text-muted-foreground">
          Neplatný modul v adrese ({raw || "—"}). Použijte odkaz z menu portálu.
        </p>
        <Button variant="link" asChild>
          <Link href="/portal/moje-moduly">Moje moduly</Link>
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

  const showAutoSpinner = auto && isLoading && phase === "loading";

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
          {showAutoSpinner ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Spouštím editor…
            </p>
          ) : null}

          {phase === "success" ? (
            <Alert>
              <AlertTitle>Editor se otevírá</AlertTitle>
              <AlertDescription>
                Pokud se nová karta nezobrazila, povolte vyskakovací okna nebo použijte tlačítko níže.
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Spuštění se nezdařilo</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            className="bg-orange-500 hover:bg-orange-600 text-black"
            disabled={isLoading}
            onClick={() => void launch(user, { openInNewTab: true })}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : moduleCode === "rajmondata_editor" ? (
              "Spustit RAJMONDATA EDITOR"
            ) : (
              `Spustit ${title}`
            )}
          </Button>

          {error ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                void launch(user, { openInNewTab: true });
              }}
            >
              Zkusit znovu
            </Button>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Editor se otevře v nové kartě. V URL je pouze jednorázový ticket, ne Firebase token.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/portal/moje-moduly">Moje moduly</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
