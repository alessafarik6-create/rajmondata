"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Satellite } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { startSatelitniOAuthConnect } from "@/components/fleet/satelitni-connect-actions";

type Props = {
  companyId: string;
  /** Owner / admin — smí spustit OAuth. */
  canManageIntegration: boolean;
  compact?: boolean;
};

export function FleetGpsNotConnectedPanel({ companyId, canManageIntegration, compact }: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (!user || !companyId || !canManageIntegration) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const result = await startSatelitniOAuthConnect(companyId, token);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Připojení", description: result.error });
        return;
      }
      window.location.href = result.authorizeUrl;
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <Card className="border-dashed border-primary/30">
        <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-sm text-muted-foreground">
            GPS monitoring není připojen. Propojte SatelitníSledování.cz (OAuth 2.1).
          </p>
          {canManageIntegration ? (
            <Button disabled={busy} onClick={() => void connect()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Připojit SatelitníSledování.cz"}
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/portal/settings?tab=integrace">Nastavení → Integrace</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Satellite className="h-5 w-5" />
          SatelitníSledování.cz
        </CardTitle>
        <CardDescription>GPS monitoring vozového parku přes REST API v2 (OAuth 2.1 + PKCE).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          Stav: <span className="font-medium">Nepřipojeno</span>
        </p>
        {canManageIntegration ? (
          <Button disabled={busy} onClick={() => void connect()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Připojit SatelitníSledování.cz
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Připojení smí provést administrátor organizace v{" "}
            <Link href="/portal/settings?tab=integrace" className="text-primary underline-offset-2 hover:underline">
              Nastavení → Integrace → GPS / Vozový park
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
