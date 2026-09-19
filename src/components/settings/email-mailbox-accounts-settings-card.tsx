"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  lastSyncAt: string | null;
  lastError: string | null;
};

export function EmailMailboxAccountsSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [busy, setBusy] = useState(false);

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
                  <span
                    className={
                      a.status === "connected"
                        ? "text-green-600"
                        : a.status === "syncing"
                          ? "text-blue-600"
                          : a.status === "error"
                            ? "text-destructive"
                            : "text-amber-600"
                    }
                  >
                    ●{" "}
                    {a.status === "connected"
                      ? "Připojeno"
                      : a.status === "syncing"
                        ? "Synchronizuje se"
                        : a.status === "error"
                          ? "Chyba připojení"
                          : a.status === "attention"
                            ? "Vyžaduje pozornost"
                            : a.status}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Poslední synchronizace:{" "}
                  {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString("cs-CZ") : "—"}
                </p>
                {a.lastError ? <p className="text-destructive text-xs">Chyba: {a.lastError}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void syncNow(a.id)}>
                    Synchronizovat
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setShowWizard(true)}>
                    Nastavení
                  </Button>
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
