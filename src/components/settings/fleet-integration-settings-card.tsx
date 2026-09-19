"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Car } from "lucide-react";

export function FleetIntegrationSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("not_connected");

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/fleet/integration?companyId=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok && data.integration) {
        setStatus(data.integration.status ?? "not_connected");
        setApiBaseUrl(String(data.integration.apiBaseUrl ?? ""));
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/fleet/integration", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          apiBaseUrl,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Integrace", description: data.error });
        return;
      }
      toast({ title: "Uloženo", description: data.message });
      setApiKey("");
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
        title: "Test Ecofleet",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return null;

  const statusLabel =
    status === "configured"
      ? "Nakonfigurováno (čeká na API implementaci)"
      : status === "error"
        ? "Chyba"
        : "Nepřipojeno";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="h-5 w-5" /> GPS / Vozový park — Ecofleet
        </CardTitle>
        <CardDescription>
          Integrace Ecofleet CZ. API klíč se ukládá pouze na serveru (šifrovaně). Skutečné volání API doplníme po
          dodání dokumentace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          Stav: <span className="font-medium">{statusLabel}</span>
        </p>
        <div className="space-y-2">
          <Label>API URL (Ecofleet)</Label>
          <Input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="https://… (dle dokumentace Ecofleet)"
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label>API Key / Token</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Zadejte nový klíč (neukládá se do prohlížeče)"
            autoComplete="new-password"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || loading} onClick={() => void save()}>
            Nastavit
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void testConn()}>
            Otestovat připojení
          </Button>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
