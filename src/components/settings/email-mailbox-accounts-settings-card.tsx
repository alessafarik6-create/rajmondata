"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { EmailConnectWizard } from "@/components/portal/email-connect-wizard";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";

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
};

function statusColor(status: string): string {
  if (status === "connected") return "text-green-600";
  if (status === "syncing") return "text-blue-600";
  if (
    status === "credentials_missing" ||
    status === "credentials_decrypt_failed" ||
    status === "error"
  ) {
    return "text-destructive";
  }
  if (status === "attention") return "text-amber-600";
  return "text-amber-600";
}

export function EmailMailboxAccountsSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reauthId, setReauthId] = useState<string | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");

  const load = useCallback(async () => {
    if (!user || !companyId) return;
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
          description: data.message ?? data.error ?? "Nepodařilo se načíst účty.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId, toast]);

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
        toast({
          variant: "destructive",
          title: "Sync selhal",
          description: data.message ?? data.error,
        });
        return;
      }
      toast({
        title: "Synchronizace dokončena",
        description: data.message ?? `Synchronizováno – ${(data as { imported?: number }).imported ?? 0} nových zpráv.`,
      });
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
      toast({
        title: "Heslo uloženo",
        description: String(data.message ?? "Synchronizace proběhla."),
      });
      setReauthId(null);
      setReauthPassword("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(accountId: string) {
    if (!user || !companyId || !confirm("Odpojit schránku?")) return;
    const token = await user.getIdToken();
    await fetch(
      `/api/company/email-mailbox/accounts/${accountId}?companyId=${encodeURIComponent(companyId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    await load();
  }

  if (!companyId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> E-mailové účty
        </CardTitle>
        <CardDescription>
          Připojené schránky pro synchronizaci a odesílání. Správa vyžaduje roli administrátora.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setShowWizard(true)}>
            + Připojit další schránku
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/portal/email">Otevřít e-mailový klient</Link>
          </Button>
          <Button type="button" variant="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {showWizard ? (
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
          <p className="text-sm text-muted-foreground">Zatím není připojena žádná schránka.</p>
        ) : (
          <ul className="space-y-3">
            {accounts.map((a) => (
              <li key={a.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{a.email}</p>
                <p className="text-muted-foreground">
                  {a.provider === "SEZNAM" ? "Seznam.cz" : a.provider}{" "}
                  <span className={statusColor(a.status)}>
                    ● {a.statusLabel ?? a.status}
                  </span>
                </p>
                {a.credentialReady === false ? (
                  <p className="text-destructive text-xs mt-1">
                    {a.lastError ??
                      "Přihlašovací údaje e-mailového účtu je potřeba zadat znovu."}
                  </p>
                ) : null}
                <p className="text-muted-foreground">
                  Poslední synchronizace:{" "}
                  {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString("cs-CZ") : "—"}
                </p>
                {a.lastError && a.credentialReady !== false ? (
                  <p className="text-destructive text-xs">Chyba: {a.lastError}</p>
                ) : null}
                {reauthId === a.id ? (
                  <div className="mt-3 space-y-2 rounded-md border p-3 bg-muted/20">
                    <Label>Heslo / heslo aplikace (Seznam.cz)</Label>
                    <Input
                      type="password"
                      value={reauthPassword}
                      onChange={(e) => setReauthPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Zadejte heslo znovu"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={() => void savePasswordAgain(a)}>
                        Uložit a synchronizovat
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setReauthId(null);
                          setReauthPassword("");
                        }}
                      >
                        Zrušit
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void syncNow(a.id)}>
                    Synchronizovat
                  </Button>
                  {a.credentialReady === false ? (
                    <Button size="sm" variant="default" disabled={busy} onClick={() => setReauthId(a.id)}>
                      Zadat heslo znovu
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setReauthId(a.id)}>
                      Změnit heslo
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void disconnect(a.id)}>
                    Odpojit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
