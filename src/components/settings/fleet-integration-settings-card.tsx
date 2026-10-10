"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  apiVehicleCount?: number | null;
  storedWithGpsCount?: number;
  lastSyncImportedCount?: number | null;
  lastSyncSummary?: string | null;
  lastSyncError?: string | null;
  connectedByLabel?: string | null;
  connectedAt?: string | null;
};

type DiagnosticsPayload = {
  oauthConnected: boolean;
  vehiclesApiOk: boolean;
  apiVehicleCount: number;
  storedVehicleCount: number;
  storedWithGpsCount: number;
  message: string;
  responseShape: string | null;
  lookup43081?: { inApiList: boolean; note: string };
  sampleVehicles?: { externalVehicleId: string; name: string; externalDeviceId: string | null }[];
};

export function FleetIntegrationSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [satelitni, setSatelitni] = useState<SatelitniStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const autoSyncStarted = useRef(false);

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

  const syncNow = useCallback(
    async (silent?: boolean) => {
      if (!user || !companyId) return false;
      setBusy(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/company/fleet/sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        });
        const data = await res.json();
        if (!silent) {
          toast({
            variant: data.ok ? "default" : "destructive",
            title: "Synchronizace",
            description: data.message ?? data.error,
          });
        }
        await load();
        return Boolean(data.ok);
      } finally {
        setBusy(false);
      }
    },
    [user, companyId, load, toast]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !user || !companyId) return;
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("gps") === "connected";
    const shouldSync = url.searchParams.get("gps_sync") === "1";
    if (!connected && !shouldSync) return;
    void load();
    if (shouldSync && !autoSyncStarted.current) {
      autoSyncStarted.current = true;
      void syncNow(true).then((ok) => {
        if (ok) {
          toast({
            title: "GPS synchronizace",
            description: "Po připojení proběhla automatická synchronizace vozidel.",
          });
        }
        url.searchParams.delete("gps_sync");
        url.searchParams.delete("gps");
        window.history.replaceState({}, "", url.pathname + url.search);
      });
    }
  }, [user, companyId, load, toast, syncNow]);

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
      setDiagnostics(null);
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

  async function testVehiclesApi() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/satelitni-sledovani/test-vehicles", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (data.diagnostics) setDiagnostics(data.diagnostics as DiagnosticsPayload);
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Test API vozidel",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function showDiagnostics() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/integrations/satelitni-sledovani/diagnostics?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok && data.diagnostics) {
        setDiagnostics(data.diagnostics as DiagnosticsPayload);
        toast({ title: "Diagnostika GPS", description: data.diagnostics.message });
      } else {
        toast({ variant: "destructive", title: "Diagnostika", description: data.error ?? "Chyba" });
      }
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

  const oauthOk = satelitni?.connected && satelitni.status !== "error";
  const apiOk = diagnostics?.vehiclesApiOk ?? (satelitni?.apiVehicleCount != null ? true : null);

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
          <>
            <ul className="text-sm text-muted-foreground space-y-1">
              {satelitni.connectedByLabel ? (
                <li>
                  Připojil: <span className="text-foreground">{satelitni.connectedByLabel}</span>
                </li>
              ) : null}
              {satelitni.connectedAt ? (
                <li>Připojeno: {new Date(satelitni.connectedAt).toLocaleString("cs-CZ")}</li>
              ) : null}
              <li>
                Token:{" "}
                <span className="text-foreground">
                  {satelitni.tokenActive ? "aktivní" : "obnoví se automaticky"}
                </span>
              </li>
            </ul>

            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
              <p className="font-medium text-foreground">Stav synchronizace</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>
                  OAuth spojení:{" "}
                  <span className={oauthOk ? "text-green-700 dark:text-green-400" : "text-destructive"}>
                    {oauthOk ? "Připojeno" : "Chyba"}
                  </span>
                </li>
                <li>
                  Přístup k API vozidel:{" "}
                  <span
                    className={
                      apiOk === false
                        ? "text-destructive"
                        : apiOk
                          ? "text-green-700 dark:text-green-400"
                          : "text-foreground"
                    }
                  >
                    {apiOk === false ? "Chyba" : apiOk ? "Funkční" : "Neověřeno — spusťte test"}
                  </span>
                </li>
                <li>
                  Počet vozidel vrácených API (poslední sync):{" "}
                  <span className="text-foreground">{satelitni.apiVehicleCount ?? "—"}</span>
                </li>
                <li>
                  Počet vozidel uložených v RAJMONDATA:{" "}
                  <span className="text-foreground">{satelitni.vehicleCount ?? 0}</span>
                </li>
                <li>
                  Počet vozidel s GPS polohou:{" "}
                  <span className="text-foreground">{satelitni.storedWithGpsCount ?? 0}</span>
                </li>
                <li>
                  Poslední úspěšná synchronizace:{" "}
                  {satelitni.lastSyncAt
                    ? new Date(satelitni.lastSyncAt).toLocaleString("cs-CZ")
                    : "—"}
                </li>
                {satelitni.lastSyncSummary ? (
                  <li className="text-foreground">{satelitni.lastSyncSummary}</li>
                ) : null}
                {satelitni.lastSyncError ? (
                  <li className="text-destructive">Poslední chyba: {satelitni.lastSyncError}</li>
                ) : null}
              </ul>
            </div>

            {diagnostics ? (
              <div className="rounded-md border border-dashed p-3 text-xs space-y-2 text-muted-foreground">
                <p className="font-medium text-sm text-foreground">Diagnostika API</p>
                <p>{diagnostics.message}</p>
                {diagnostics.responseShape ? <p>Tvar odpovědi: {diagnostics.responseShape}</p> : null}
                {diagnostics.lookup43081 ? <p>{diagnostics.lookup43081.note}</p> : null}
                {diagnostics.sampleVehicles?.length ? (
                  <ul className="list-disc pl-4">
                    {diagnostics.sampleVehicles.map((v) => (
                      <li key={v.externalVehicleId}>
                        {v.name} — ID {v.externalVehicleId}
                        {v.externalDeviceId ? ` (zařízení ${v.externalDeviceId})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
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
              <Button variant="outline" disabled={busy} onClick={() => void testVehiclesApi()}>
                Otestovat API vozidel
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void showDiagnostics()}>
                Zobrazit diagnostiku
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
