"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Video } from "lucide-react";

type IntegrationState = {
  deviceLabel: string;
  host: string;
  httpPort: number;
  httpsPort: number;
  rtspPort: number;
  useHttps: boolean;
  username: string;
  connectionMode: "direct" | "local_connector";
  active: boolean;
  status: string;
  hasPassword: boolean;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  deviceName: string | null;
  cameraCount: number;
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
  connectionMode: "direct",
  active: true,
  status: "not_connected",
  hasPassword: false,
  model: null,
  serialNumber: null,
  firmwareVersion: null,
  deviceName: null,
  cameraCount: 0,
  connectorOnline: false,
  lastTestAt: null,
  lastSyncAt: null,
  lastCommunicationAt: null,
  lastConnectorHeartbeatAt: null,
  lastError: null,
  allowInsecureTls: false,
};

export function HikvisionIntegrationSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyIntegration);
  const [password, setPassword] = useState("");
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/hikvision/integration?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok && data.integration) {
        setForm({ ...emptyIntegration, ...data.integration });
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
          ...form,
          password: password.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Hikvision", description: data.error });
        return;
      }
      toast({ title: "Uloženo", description: data.message });
      setPassword("");
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
        title: data.ok ? "NVR online" : "Test selhal",
        description: data.ok
          ? `${data.model ?? ""} ${data.serialNumber ?? ""}`.trim() || data.message
          : data.error,
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

  const nvrOnline = form.status === "online";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5 text-orange-600" /> Integrace → Hikvision NVR
        </CardTitle>
        <CardDescription>
          ISAPI (Pro Series). Heslo se ukládá pouze server-side šifrovaně. Snapshoty a ISAPI volání jdou
          přes zabezpečené API RAJMONDATA.
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
            NVR:{" "}
            <span className="font-medium">{nvrOnline ? "Online" : form.status === "offline" ? "Offline" : "—"}</span>
          </p>
          <p>
            Connector:{" "}
            <span className="font-medium">{form.connectorOnline ? "Online" : "Offline"}</span>
          </p>
          {form.model ? <p>Model: {form.model}</p> : null}
          {form.firmwareVersion ? <p>Firmware: {form.firmwareVersion}</p> : null}
          <p>Kamer: {form.cameraCount}</p>
          {form.lastCommunicationAt ? (
            <p className="text-xs text-muted-foreground">Poslední komunikace: {form.lastCommunicationAt}</p>
          ) : null}
          {form.lastError ? (
            <p className="text-xs text-destructive">Poslední chyba: {form.lastError}</p>
          ) : null}
        </div>

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
          <div className="space-y-2 sm:col-span-2">
            <Label>Způsob připojení</Label>
            <Select
              value={form.connectionMode}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  connectionMode: v === "local_connector" ? "local_connector" : "direct",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct connection (cloud → NVR, pokud je dostupné)</SelectItem>
                <SelectItem value="local_connector">Local Connector (doporučeno v LAN)</SelectItem>
              </SelectContent>
            </Select>
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
          <div className="flex items-center gap-2">
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
            />
            <Label>Aktivní</Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Uložit
          </Button>
          <Button type="button" variant="secondary" onClick={() => void testConn()} disabled={busy}>
            Otestovat připojení
          </Button>
          <Button type="button" variant="outline" onClick={() => void syncCameras()} disabled={busy}>
            Načíst kamery z NVR
          </Button>
          <Button type="button" variant="outline" onClick={() => void createConnectorToken()} disabled={busy}>
            Token pro Local Connector
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
