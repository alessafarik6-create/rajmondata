"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Satellite } from "lucide-react";
import { startSatelitniOAuthConnect } from "@/components/fleet/satelitni-connect-actions";

type SatelitniStatus = {
  connected: boolean;
  status: string;
  tokenActive?: boolean;
  lastSyncAt?: string | null;
  vehicleCount?: number;
  lastSyncError?: string | null;
  connectedByLabel?: string | null;
  connectedAt?: string | null;
};

export function FleetIntegrationSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [satelitni, setSatelitni] = useState<SatelitniStatus | null>(null);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/integrations/satelitni-sledovani/status?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok) setSatelitni(data);
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    if (!user || !companyId) return;
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

  async function disconnect() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/satelitni-sledovani/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Odpojení",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function testConn() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/fleet/integration/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Test spojení",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/fleet/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Synchronizace",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return null;

  const statusLabel = !satelitni?.connected
    ? "Nepřipojeno"
    : satelitni.status === "error"
      ? "Chyba"
      : "Připojeno";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Satellite className="h-5 w-5" />
          SatelitníSledování.cz
        </CardTitle>
        <CardDescription>
          Nastavení → Integrace → GPS / Vozový park. OAuth 2.1 + PKCE, bez API klíče a hesla.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          Stav: <span className="font-medium">{loading ? "…" : statusLabel}</span>
        </p>

        {satelitni?.connected ? (
          <ul className="text-sm text-muted-foreground space-y-1">
            {satelitni.connectedByLabel ? (
              <li>
                Připojil: <span className="text-foreground">{satelitni.connectedByLabel}</span>
              </li>
            ) : null}
            {satelitni.connectedAt ? (
              <li>
                Připojeno: {new Date(satelitni.connectedAt).toLocaleString("cs-CZ")}
              </li>
            ) : null}
            <li>
              Token:{" "}
              <span className="text-foreground">
                {satelitni.tokenActive ? "aktivní" : "obnoví se automaticky"}
              </span>
            </li>
            <li>
              Počet vozidel: <span className="text-foreground">{satelitni.vehicleCount ?? 0}</span>
            </li>
            <li>
              Poslední synchronizace:{" "}
              {satelitni.lastSyncAt
                ? new Date(satelitni.lastSyncAt).toLocaleString("cs-CZ")
                : "—"}
            </li>
            {satelitni.lastSyncError ? (
              <li className="text-destructive">{satelitni.lastSyncError}</li>
            ) : null}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!satelitni?.connected ? (
            <Button disabled={busy || loading} onClick={() => void connect()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Připojit SatelitníSledování.cz
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void syncNow()}>
                Synchronizovat nyní
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void testConn()}>
                Otestovat spojení
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>
                Odpojit
              </Button>
            </>
          )}
          {loading ? <Loader2 className="h-4 w-4 animate-spin self-center" /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
