"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
} from "@/firebase";
import { doc } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, RefreshCw, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  getTerminalAccessAbsoluteUrl,
  getTerminalAccessPath,
} from "@/lib/terminal-access-url";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Props = {
  companyId: string | undefined;
  canManage: boolean;
};

export function TerminalTabletLinkSection({ companyId, canManage }: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  /** Okamžité zobrazení tokenu po úspěšném API, než dorazí snapshot z Firestore. */
  const [tokenOverride, setTokenOverride] = useState<string | null>(null);

  const terminalSettingsRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, "companies", companyId, "settings", "terminal")
        : null,
    [firestore, companyId]
  );

  const {
    data: terminalSettings,
    isLoading,
    error,
  } = useDoc<{
    token?: string;
    updatedAt?: unknown;
  }>(terminalSettingsRef);

  const tokenFromSettings =
    typeof terminalSettings?.token === "string" ? terminalSettings.token : "";
  const token = (tokenOverride ?? tokenFromSettings).trim();

  useEffect(() => {
    if (tokenFromSettings && tokenOverride && tokenFromSettings === tokenOverride) {
      setTokenOverride(null);
    }
  }, [tokenFromSettings, tokenOverride]);

  const fullUrl = useMemo(() => {
    if (!token) return "";
    return getTerminalAccessAbsoluteUrl(token);
  }, [token]);

  const pathOnly = token ? getTerminalAccessPath(token) : "";

  const handleRefresh = useCallback(async () => {
    if (!canManage || !companyId || !user) return;
    setSaving(true);
    setLinkError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/terminal-access-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ companyId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        success?: boolean;
      };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : "Odkaz se nepodařilo vytvořit.";
        setLinkError(msg);
        toast({
          variant: "destructive",
          title: "Chyba",
          description: msg,
        });
        return;
      }
      if (typeof data.token === "string" && data.token.length > 0) {
        setTokenOverride(data.token);
      }
      toast({ title: "Odkaz byl uložen." });
    } catch (e) {
      console.error("[TerminalTabletLinkSection]", e);
      const msg = "Odkaz se nepodařilo vytvořit. Zkuste to znovu.";
      setLinkError(msg);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }, [canManage, companyId, user, toast]);

  const handleCopy = useCallback(async () => {
    if (!fullUrl) {
      toast({
        variant: "destructive",
        title: "Nejdřív vygenerujte odkaz",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast({ title: "Odkaz zkopírován do schránky" });
    } catch {
      toast({
        variant: "destructive",
        title: "Kopírování se nezdařilo",
      });
    }
  }, [fullUrl, toast]);

  if (!companyId || !user) {
    return null;
  }

  if (!canManage) {
    return null;
  }

  return (
    <Card className="border-primary/15 shadow-sm overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg sm:text-xl">Odkaz pro tablet</CardTitle>
        <p className="text-sm text-muted-foreground">
          Trvalý přístup k docházkovému terminálu bez přihlášení e‑mailem — po
          otevření odkazu se tablet přihlásí automaticky. Odkaz držte v tajnosti.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Načítání odkazu…</span>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">
            Odkaz se nepodařilo načíst. Zkuste obnovit stránku.
          </p>
        )}

        {linkError && (
          <Alert variant="destructive">
            <AlertTitle>Odkaz se nepodařilo uložit</AlertTitle>
            <AlertDescription>{linkError}</AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && (
          <>
            <div className="rounded-lg border bg-muted/30 p-3 sm:p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Cesta (relativní)
              </p>
              <code className="text-sm sm:text-base font-mono break-all block">
                {pathOnly || "— zatím není vygenerován —"}
              </code>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Button
                type="button"
                variant="default"
                size="lg"
                className="min-h-[52px] w-full sm:flex-1 text-base touch-manipulation"
                onClick={() => void handleCopy()}
                disabled={!token || saving}
              >
                <Copy className="w-5 h-5 mr-2 shrink-0" />
                Zkopírovat odkaz
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="min-h-[52px] w-full sm:flex-1 text-base touch-manipulation"
                onClick={() => void handleRefresh()}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin shrink-0" />
                ) : (
                  <RefreshCw className="w-5 h-5 mr-2 shrink-0" />
                )}
                {token ? "Obnovit odkaz" : "Vygenerovat odkaz"}
              </Button>
            </div>

            {fullUrl && (
              <div className="flex flex-col items-center gap-3 pt-2 border-t">
                <p className="text-sm text-muted-foreground text-center">
                  QR kód pro otevření na tabletu
                </p>
                <div className="rounded-xl border-2 border-border bg-white p-4 shadow-inner">
                  <QRCodeSVG
                    value={fullUrl}
                    size={200}
                    level="M"
                    includeMargin
                    className="max-w-full h-auto w-[min(200px,70vw)]"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
