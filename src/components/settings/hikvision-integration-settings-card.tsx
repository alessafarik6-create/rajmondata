"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Video, Cloud, Server, Plug } from "lucide-react";

type ConnectionMode = "HIKCONNECT_OPENAPI" | "DIRECT_ISAPI" | "LOCAL_CONNECTOR";

type IntegrationLifecycle =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "CONNECTED"
  | "ERROR";

function normalizeModeFromApi(raw: string | undefined): ConnectionMode {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (v === "hikconnect_openapi" || v === "hikconnect" || v === "hik_connect_openapi") {
    return "HIKCONNECT_OPENAPI";
  }
  if (v === "local_connector") return "LOCAL_CONNECTOR";
  if (v === "direct" || v === "direct_isapi") return "DIRECT_ISAPI";
  return "HIKCONNECT_OPENAPI";
}

type IntegrationState = {
  deviceLabel: string;
  host: string;
  httpPort: number;
  httpsPort: number;
  rtspPort: number;
  useHttps: boolean;
  username: string;
  connectionMode: ConnectionMode;
  active: boolean;
  status: string;
  hasPassword: boolean;
  hasApiSecret: boolean;
  hasApiKey: boolean;
  apiKey: string;
  integrationConfigured: boolean;
  lifecycle: IntegrationLifecycle;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  deviceName: string | null;
  cameraCount: number;
  deviceCount: number;
  hikConnectTeamName: string | null;
  connectorOnline: boolean;
  lastTestAt: string | null;
  lastSyncAt: string | null;
  lastCommunicationAt: string | null;
  lastConnectorHeartbeatAt: string | null;
  lastError: string | null;
  allowInsecureTls: boolean;
};

const emptyIntegration: IntegrationState = {
  deviceLabel: "",
  host: "",
  httpPort: 80,
  httpsPort: 443,
  rtspPort: 554,
  useHttps: false,
  username: "admin",
  connectionMode: "HIKCONNECT_OPENAPI",
  active: true,
  status: "not_connected",
  lifecycle: "NOT_CONFIGURED",
  hasPassword: false,
  hasApiSecret: false,
  hasApiKey: false,
  apiKey: "",
  integrationConfigured: false,
  model: null,
  serialNumber: null,
  firmwareVersion: null,
  deviceName: null,
  cameraCount: 0,
  deviceCount: 0,
  hikConnectTeamName: null,
  connectorOnline: false,
  lastTestAt: null,
  lastSyncAt: null,
  lastCommunicationAt: null,
  lastConnectorHeartbeatAt: null,
  lastError: null,
  allowInsecureTls: false,
};

function modeLabel(mode: ConnectionMode): string {
  if (mode === "HIKCONNECT_OPENAPI") return "Hik-Connect Cloud / OpenAPI";
  if (mode === "LOCAL_CONNECTOR") return "Local Connector";
  return "Direct ISAPI";
}

function lifecycleLabel(lifecycle: IntegrationLifecycle, isCloud: boolean): string {
  if (lifecycle === "CONNECTED") return "✓ Připojeno";
  if (lifecycle === "CONFIGURED") {
    return isCloud ? "Konfigurace uložena · API spojení neověřeno" : "Nakonfigurováno";
  }
  if (lifecycle === "ERROR") return "Chyba";
  return "Nepřipojeno";
}

export function HikvisionIntegrationSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyIntegration);
  const [password, setPassword] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/hikvision/integration?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const data = await res.json();
      if (data.ok && data.integration) {
        const connectionMode = normalizeModeFromApi(data.integration.connectionMode);
        setForm({
          ...emptyIntegration,
          ...data.integration,
          connectionMode,
          lifecycle: (data.integration.lifecycle as IntegrationLifecycle) ?? "NOT_CONFIGURED",
        });
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
      const res = await fetch("/api/company/hikvision/integration", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          connectionMode: form.connectionMode,
          active: form.active,
          deviceLabel: form.connectionMode === "DIRECT_ISAPI" ? form.deviceLabel : undefined,
          host: form.connectionMode === "DIRECT_ISAPI" ? form.host : undefined,
          httpPort: form.connectionMode === "DIRECT_ISAPI" ? form.httpPort : undefined,
          httpsPort: form.connectionMode === "DIRECT_ISAPI" ? form.httpsPort : undefined,
          rtspPort: form.connectionMode === "DIRECT_ISAPI" ? form.rtspPort : undefined,
          useHttps: form.connectionMode === "DIRECT_ISAPI" ? form.useHttps : undefined,
          username: form.connectionMode === "DIRECT_ISAPI" ? form.username : undefined,
          allowInsecureTls: form.connectionMode === "DIRECT_ISAPI" ? form.allowInsecureTls : undefined,
          password: form.connectionMode === "DIRECT_ISAPI" ? password.trim() || undefined : undefined,
          apiKey: form.connectionMode === "HIKCONNECT_OPENAPI" ? form.apiKey : undefined,
          apiSecret:
            form.connectionMode === "HIKCONNECT_OPENAPI" && apiSecret.trim()
              ? apiSecret.trim()
              : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Hikvision", description: data.error });
        return;
      }
      toast({ title: "Uloženo", description: data.message });
      setPassword("");
      setApiSecret("");
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
      const res = await fetch("/api/company/hikvision/integration/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: data.ok ? "✓ Připojení OK" : "✕ Připojení selhalo",
        description: data.ok
          ? data.message ?? `${data.provider ?? ""} ${data.latencyMs != null ? `${data.latencyMs} ms` : ""}`
          : data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncDevices() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/hikvision/integration/sync-devices", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Zařízení",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncCameras() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/hikvision/integration/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      toast({
        variant: data.ok ? "default" : "destructive",
        title: "Synchronizace kamer",
        description: data.message ?? data.error,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function createConnectorToken() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/hikvision/connector/register-token", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Connector", description: data.error });
        return;
      }
      setRegistrationToken(data.registrationToken);
      toast({ title: "Registrační token", description: data.message });
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) return null;

  const isCloud = form.connectionMode === "HIKCONNECT_OPENAPI";
  const isDirect = form.connectionMode === "DIRECT_ISAPI";
  const isConnector = form.connectionMode === "LOCAL_CONNECTOR";
  const cloudReadyForTest =
    isCloud && form.active && form.hasApiKey && form.hasApiSecret && form.integrationConfigured;
  const canTest = isCloud ? cloudReadyForTest || (form.apiKey.trim() && apiSecret.trim()) : true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5 text-orange-600" /> Integrace → Hikvision
        </CardTitle>
        <CardDescription>
          Hik-Connect Cloud (doporučeno) nebo přímé ISAPI / Local Connector. Tajemství (API Secret, heslo
          NVR) se ukládají pouze server-side šifrovaně.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Načítání…
          </p>
        ) : null}

        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <p>
            Režim: <span className="font-medium">{modeLabel(form.connectionMode)}</span>
          </p>
          <p>
            Stav:{" "}
            <span className="font-medium">{lifecycleLabel(form.lifecycle, isCloud)}</span>
          </p>
          {isCloud && form.integrationConfigured ? (
            <p className="text-xs text-muted-foreground">
              OpenAPI přihlašovací údaje jsou uloženy.
              {form.lifecycle !== "CONNECTED"
                ? " Pro dokončení API komunikace je nutná Hik-Connect OpenAPI specifikace na serveru."
                : null}
            </p>
          ) : null}
          {isCloud && form.hasApiSecret ? (
            <p className="text-xs text-green-700">API Secret je uložen</p>
          ) : null}
          {isCloud && form.hikConnectTeamName ? <p>Team: {form.hikConnectTeamName}</p> : null}
          {isDirect && form.model ? <p>Model: {form.model}</p> : null}
          {isConnector ? (
            <p>
              Connector:{" "}
              <span className="font-medium">{form.connectorOnline ? "Online" : "Offline"}</span>
            </p>
          ) : null}
          <p>
            Zařízení: {form.deviceCount} · Kamer: {form.cameraCount}
          </p>
          {form.lastSyncAt ? (
            <p className="text-xs text-muted-foreground">Poslední synchronizace: {form.lastSyncAt}</p>
          ) : null}
          {form.lastError ? (
            <p className="text-xs text-destructive">Poslední chyba: {form.lastError}</p>
          ) : null}
        </div>

        <div className="space-y-3">
          <Label>Způsob připojení</Label>
          <RadioGroup
            value={form.connectionMode}
            onValueChange={(v) =>
              setForm((f) => ({
                ...f,
                connectionMode: v as ConnectionMode,
              }))
            }
            className="space-y-2"
          >
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-orange-500">
              <RadioGroupItem value="HIKCONNECT_OPENAPI" className="mt-1" />
              <div>
                <p className="font-medium flex items-center gap-1">
                  <Cloud className="h-4 w-4" /> Hik-Connect Cloud / OpenAPI
                </p>
                <p className="text-xs text-muted-foreground">
                  Doporučeno — bez veřejné IP a bez zařízení ve firemní síti
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-orange-500">
              <RadioGroupItem value="DIRECT_ISAPI" className="mt-1" />
              <div>
                <p className="font-medium flex items-center gap-1">
                  <Server className="h-4 w-4" /> Direct ISAPI
                </p>
                <p className="text-xs text-muted-foreground">Přímé připojení k NVR (LAN / veřejná IP)</p>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-orange-500">
              <RadioGroupItem value="LOCAL_CONNECTOR" className="mt-1" />
              <div>
                <p className="font-medium flex items-center gap-1">
                  <Plug className="h-4 w-4" /> Local Connector
                </p>
                <p className="text-xs text-muted-foreground">Agent ve firemní LAN</p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {isCloud ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>API Key / Access Key</Label>
              <Input
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>
                API Secret / Secret Key{" "}
                {form.hasApiSecret ? "(uloženo — vyplňte pouze pro změnu)" : ""}
              </Label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={form.hasApiSecret ? "••••••••••••••" : ""}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {isDirect ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Název zařízení</Label>
              <Input
                value={form.deviceLabel}
                onChange={(e) => setForm((f) => ({ ...f, deviceLabel: e.target.value }))}
                placeholder="NVR sklad"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Host / IP NVR</Label>
              <Input
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="192.168.1.64"
              />
            </div>
            <div className="space-y-2">
              <Label>HTTP port</Label>
              <Input
                type="number"
                value={form.httpPort}
                onChange={(e) => setForm((f) => ({ ...f, httpPort: Number(e.target.value) || 80 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>HTTPS port</Label>
              <Input
                type="number"
                value={form.httpsPort}
                onChange={(e) => setForm((f) => ({ ...f, httpsPort: Number(e.target.value) || 443 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>RTSP port</Label>
              <Input
                type="number"
                value={form.rtspPort}
                onChange={(e) => setForm((f) => ({ ...f, rtspPort: Number(e.target.value) || 554 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Uživatelské jméno</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Heslo {form.hasPassword ? "(uloženo — vyplňte pro změnu)" : ""}</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.useHttps}
                onCheckedChange={(v) => setForm((f) => ({ ...f, useHttps: v }))}
              />
              <Label>Použít HTTPS pro ISAPI</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.allowInsecureTls}
                onCheckedChange={(v) => setForm((f) => ({ ...f, allowInsecureTls: v }))}
              />
              <Label>Povolit self-signed certifikát (LAN)</Label>
            </div>
          </div>
        ) : null}

        {isConnector ? (
          <p className="text-sm text-muted-foreground">
            Vygenerujte registrační token a spusťte Local Connector ve firmě. Sync kamer probíhá přes
            connector (TODO).
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Switch
            checked={form.active}
            onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
          />
          <Label>Integrace aktivní</Label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Uložit
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void testConn()}
            disabled={busy || !canTest}
          >
            {isCloud ? "Otestovat Hik-Connect" : "Otestovat připojení"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void syncDevices()} disabled={busy}>
            Načíst zařízení
          </Button>
          <Button type="button" variant="outline" onClick={() => void syncCameras()} disabled={busy}>
            Synchronizovat kamery
          </Button>
          {isConnector ? (
            <Button type="button" variant="outline" onClick={() => void createConnectorToken()} disabled={busy}>
              Token pro Local Connector
            </Button>
          ) : null}
          <Button type="button" variant="ghost" asChild>
            <Link href="/portal/cameras">Otevřít kamery</Link>
          </Button>
        </div>

        {registrationToken ? (
          <div className="rounded border border-orange-200 bg-orange-50 p-3 text-xs break-all">
            <p className="font-semibold text-orange-900 mb-1">Registrační token (1× zobrazení)</p>
            <code>{registrationToken}</code>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
