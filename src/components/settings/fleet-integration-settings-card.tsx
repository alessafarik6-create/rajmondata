"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Car, Satellite } from "lucide-react";

type SatelitniStatus = {
  connected: boolean;
  status: string;
  tokenActive?: boolean;
  lastSyncAt?: string | null;
  vehicleCount?: number;
  lastSyncError?: string | null;
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
      const res = await fetch(
        `/api/integrations/satelitni-sledovani/connect?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data.ok || !data.authorizeUrl) {
        toast({ variant: "destructive", title: "Připojení", description: data.error ?? "Chyba" });
        return;
      }
      window.location.href = String(data.authorizeUrl);
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
        title: "Test SatelitníSledování.cz",
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
        title: "Synchronizace vozového parku",
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
          <Satellite className="h-5 w-5" /> GPS / Vozový park — SatelitníSledování.cz
        </CardTitle>
        <CardDescription>
          REST API v2 s OAuth 2.1 (PKCE). Tokeny zůstávají pouze na serveru RAJMONDATA, šifrovaně.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          Stav: <span className="font-medium">{statusLabel}</span>
          {satelitni?.connected ? (
            <>
              {" "}
              · Token:{" "}
              <span className="font-medium">{satelitni.tokenActive ? "aktivní" : "obnoví se při dalším požadavku"}</span>
            </>
          ) : null}
        </p>
        {satelitni?.connected ? (
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>Počet vozidel v RAJMONDATA: {satelitni.vehicleCount ?? 0}</li>
            <li>
              Poslední synchronizace:{" "}
              {satelitni.lastSyncAt
                ? new Date(satelitni.lastSyncAt).toLocaleString("cs-CZ")
                : "—"}
            </li>
            {satelitni.lastSyncError ? <li className="text-destructive">{satelitni.lastSyncError}</li> : null}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!satelitni?.connected ? (
            <Button disabled={busy || loading} onClick={() => void connect()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Připojit účet"}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void testConn()}>
                Otestovat spojení
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void syncNow()}>
                Spustit synchronizaci
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>
                Odpojit
              </Button>
            </>
          )}
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Car className="h-3 w-3" />
          Legacy Ecofleet (API klíč) lze ponechat v kódu pro jiné organizace; tato organizace používá SatelitníSledování.cz
          v2.
        </p>
      </CardContent>
    </Card>
  );
}
