"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { EmailConnectWizard } from "@/components/portal/email-connect-wizard";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { Badge } from "@/components/ui/badge";

type AccountRow = {
  id: string;
  provider: string;
  email: string;
  status: string;
  statusLabel?: string | null;
  credentialReady?: boolean;
  credentialErrorCode?: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  disconnected?: boolean;
};

function statusColor(status: string, disconnected?: boolean): string {
  if (disconnected || status === "disconnected") return "text-muted-foreground";
  if (status === "connected") return "text-green-600";
  if (status === "syncing") return "text-blue-600";
  if (
    status === "credentials_missing" ||
    status === "credentials_decrypt_failed" ||
    status === "error"
  ) {
    return "text-destructive";
  }
  return "text-amber-600";
}

export function EmailMyMailboxSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const access = usePortalModuleAccess("emails");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reauthId, setReauthId] = useState<string | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<AccountRow | null>(null);

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/email-mailbox/accounts?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ accounts?: AccountRow[] }>(res);
      if (data.ok && Array.isArray(data.accounts)) setAccounts(data.accounts);
      else if (!data.ok) {
        toast({
          variant: "destructive",
          title: "E-mailové účty",
          description: data.message ?? data.error ?? "Nepodařilo se načíst schránky.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow(accountId: string) {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/email-mailbox/accounts/${accountId}/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await parseEmailApiResponse(res);
      if (!data.ok) {
        toast({ variant: "destructive", title: "Sync selhal", description: data.message ?? data.error });
        return;
      }
      toast({ title: "Synchronizace dokončena", description: data.message });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncAllMine() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/email-mailbox/accounts/sync-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await parseEmailApiResponse(res);
      if (!data.ok) {
        toast({ variant: "destructive", title: "Sync selhal", description: data.message ?? data.error });
        return;
      }
      toast({ title: "Hotovo", description: data.message });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(accountId: string) {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/email-mailbox/accounts/${accountId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, setDefault: true }),
      });
      const data = await parseEmailApiResponse(res);
      if (!data.ok) {
        toast({ variant: "destructive", title: "Výchozí účet", description: data.message ?? data.error });
        return;
      }
      toast({ title: "Výchozí schránka nastavena" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function savePasswordAgain(account: AccountRow) {
    if (!user || !companyId || !reauthPassword.trim()) {
      toast({ variant: "destructive", title: "Zadejte heslo schránky" });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/email-mailbox/accounts/${account.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          username: account.email,
          password: reauthPassword,
          runSync: true,
        }),
      });
      const data = await parseEmailApiResponse(res);
      if (!data.ok) {
        toast({
          variant: "destructive",
          title: "Uložení hesla selhalo",
          description: data.message ?? data.error,
        });
        return;
      }
      toast({ title: "Heslo uloženo", description: String(data.message ?? "") });
      setReauthId(null);
      setReauthPassword("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisconnect() {
    if (!user || !companyId || !disconnectTarget) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/email-mailbox/accounts/${disconnectTarget.id}?companyId=${encodeURIComponent(companyId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse(res);
      if (!data.ok) {
        toast({ variant: "destructive", title: "Odpojení selhalo", description: data.message ?? data.error });
        return;
      }
      toast({
        title: "Účet odpojen",
        description: String(data.message ?? "Historická komunikace zůstala zachována."),
      });
      setDisconnectTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!companyId || !access.canRead) return null;

  const connectedCount = accounts.filter((a) => !a.disconnected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> Moje e-mailové účty
        </CardTitle>
        <CardDescription>
          Můžete mít více schránek (např. osobní i obchodní). Každá má vlastní přihlašovací údaje. Změnu adresy
          řešte připojením nového účtu a odpojením starého.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          {access.canWrite ? (
            <>
              <Button type="button" className="min-h-[44px]" onClick={() => setShowWizard(true)}>
                + Připojit další e-mail
              </Button>
              {connectedCount > 1 ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void syncAllMine()}>
                  Synchronizovat všechny moje účty
                </Button>
              ) : null}
            </>
          ) : null}
          <Button type="button" variant="outline" asChild className="min-h-[44px]">
            <Link href="/portal/email">Otevřít poštu</Link>
          </Button>
          <Button type="button" variant="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {showWizard && access.canWrite ? (
          <EmailConnectWizard
            companyId={companyId}
            getToken={() => user!.getIdToken()}
            onConnected={() => {
              setShowWizard(false);
              void load();
            }}
            onCancel={() => setShowWizard(false)}
          />
        ) : null}

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Zatím nemáte připojenou schránku. Použijte tlačítko výše pro první připojení.
          </p>
        ) : (
          <ul className="space-y-3">
            {accounts.map((a) => (
              <li key={a.id} className="rounded-lg border p-3 sm:p-4 text-sm space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium break-all">{a.email}</p>
                  {a.isDefault ? <Badge variant="secondary">Výchozí</Badge> : null}
                  {a.disconnected ? <Badge variant="outline">Odpojeno</Badge> : null}
                </div>
                <p className="text-muted-foreground">
                  {a.provider === "SEZNAM" ? "Seznam.cz" : a.provider}{" "}
                  <span className={statusColor(a.status, a.disconnected)}>
                    ● {a.disconnected ? "Odpojeno" : (a.statusLabel ?? a.status)}
                  </span>
                </p>
                {a.disconnected ? (
                  <p className="text-xs text-muted-foreground">
                    Účet je odpojený. Historická komunikace zůstala zachována v RAJMONDATA.
                  </p>
                ) : null}
                {!a.disconnected && a.credentialReady === false ? (
                  <p className="text-destructive text-xs">{a.lastError ?? "Je potřeba znovu zadat heslo."}</p>
                ) : null}
                {!a.disconnected ? (
                  <p className="text-muted-foreground text-xs">
                    Poslední sync:{" "}
                    {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString("cs-CZ") : "—"}
                  </p>
                ) : null}
                {reauthId === a.id && access.canWrite && !a.disconnected ? (
                  <div className="space-y-2 rounded-md border p-3 bg-muted/20">
                    <Label>Heslo / heslo aplikace</Label>
                    <Input
                      type="password"
                      value={reauthPassword}
                      onChange={(e) => setReauthPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={() => void savePasswordAgain(a)}>
                        Uložit a synchronizovat
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReauthId(null)}>
                        Zrušit
                      </Button>
                    </div>
                  </div>
                ) : null}
                {access.canWrite ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/portal/email?account=${encodeURIComponent(a.id)}`}>Otevřít</Link>
                    </Button>
                    {!a.disconnected ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void syncNow(a.id)}>
                        Sync
                      </Button>
                    ) : null}
                    {!a.disconnected && !a.isDefault ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void setDefault(a.id)}>
                        Nastavit jako výchozí
                      </Button>
                    ) : null}
                    {!a.disconnected ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setReauthId(a.id)}>
                        Nastavení
                      </Button>
                    ) : null}
                    {!a.disconnected ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setDisconnectTarget(a)}>
                        Odpojit
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={Boolean(disconnectTarget)} onOpenChange={(o) => !o && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Odpojit e-mailový účet?</AlertDialogTitle>
            <AlertDialogDescription>
              Opravdu chcete odpojit účet {disconnectTarget?.email}? Credentials budou smazány a synchronizace
              skončí. Historie zpráv v RAJMONDATA zůstane. Pro změnu adresy nejdříve připojte nový účet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirmDisconnect()}>
              Odpojit účet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
