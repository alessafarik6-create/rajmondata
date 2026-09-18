"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { EMAIL_PROVIDER_PRESETS } from "@/lib/email-mailbox/provider-presets";
import type { EmailProviderKind } from "@/lib/email-mailbox/types";
import { Loader2, Mail, RefreshCw } from "lucide-react";

type AccountRow = {
  id: string;
  provider: EmailProviderKind;
  email: string;
  displayName: string | null;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

async function apiJson(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res.json();
}

export function EmailMailboxAccountsSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"list" | "pick" | "form">("list");
  const [provider, setProvider] = useState<EmailProviderKind>("SEZNAM");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const data = await apiJson(
        token,
        `/api/company/email-mailbox/accounts?companyId=${encodeURIComponent(companyId)}`
      );
      if (data.ok && Array.isArray(data.accounts)) {
        setAccounts(data.accounts as AccountRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setStep("list");
    setPassword("");
    setEmail("");
    setDisplayName("");
  };

  const providerPreset = EMAIL_PROVIDER_PRESETS.find((p) => p.provider === provider);

  async function runTest() {
    if (!user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const data = await apiJson(token, "/api/company/email-mailbox/accounts/test", {
        method: "POST",
        body: JSON.stringify({
          provider,
          email,
          password,
          imapHost: provider === "IMAP_SMTP" ? imapHost : undefined,
          smtpHost: provider === "IMAP_SMTP" ? smtpHost : undefined,
        }),
      });
      if (!data.ok) {
        toast({ variant: "destructive", title: "Test selhal", description: String(data.error ?? "") });
        return;
      }
      toast({ title: "Připojení OK", description: "IMAP i SMTP odpovídají." });
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const data = await apiJson(token, "/api/company/email-mailbox/accounts", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          provider,
          email,
          password,
          displayName,
          imapHost: provider === "IMAP_SMTP" ? imapHost : undefined,
          smtpHost: provider === "IMAP_SMTP" ? smtpHost : undefined,
        }),
      });
      if (!data.ok) {
        toast({ variant: "destructive", title: "Nepodařilo se připojit", description: String(data.error ?? "") });
        return;
      }
      toast({ title: "Schránka připojena" });
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(accountId: string) {
    if (!user || !companyId) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const data = await apiJson(token, `/api/company/email-mailbox/accounts/${accountId}/sync`, {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      if (!data.ok) {
        toast({ variant: "destructive", title: "Sync selhal", description: String(data.error ?? "") });
        return;
      }
      toast({
        title: "Synchronizace dokončena",
        description: `Nových zpráv: ${String(data.imported ?? 0)}`,
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(accountId: string) {
    if (!user || !companyId || !confirm("Odpojit schránku?")) return;
    const token = await user.getIdToken();
    await apiJson(
      token,
      `/api/company/email-mailbox/accounts/${accountId}?companyId=${encodeURIComponent(companyId)}`,
      { method: "DELETE" }
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
          Připojené schránky pro synchronizaci doručené pošty a odesílání přes SMTP (Seznam.cz jako první
          provider).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "list" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setStep("pick")}>
                Přidat e-mailovou schránku
              </Button>
              <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím není připojena žádná schránka.</p>
            ) : (
              <ul className="space-y-3">
                {accounts.map((a) => (
                  <li key={a.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">
                      {a.provider === "SEZNAM" ? "Seznam.cz" : a.provider} — {a.email}
                    </p>
                    <p>
                      Stav:{" "}
                      <span className={a.status === "connected" ? "text-green-600" : "text-amber-600"}>
                        {a.status === "connected" ? "Připojeno" : a.status}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      Poslední synchronizace:{" "}
                      {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString("cs-CZ") : "—"}
                    </p>
                    <p className="text-muted-foreground">Poslední chyba: {a.lastError || "—"}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void syncNow(a.id)}>
                        Synchronizovat
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void disconnect(a.id)}>
                        Odpojit
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}

        {step === "pick" ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Vyberte poskytovatele</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EMAIL_PROVIDER_PRESETS.map((p) => (
                <Button
                  key={p.provider}
                  type="button"
                  variant={p.implemented ? "secondary" : "ghost"}
                  disabled={!p.implemented}
                  className="h-auto flex-col items-start py-3"
                  onClick={() => {
                    if (!p.implemented) return;
                    setProvider(p.provider);
                    setStep("form");
                  }}
                >
                  <span>{p.label}</span>
                  {!p.implemented ? (
                    <span className="text-xs text-muted-foreground">{p.comingSoonLabel ?? "Připravujeme"}</span>
                  ) : null}
                </Button>
              ))}
            </div>
            <Button type="button" variant="ghost" onClick={() => setStep("list")}>
              Zpět
            </Button>
          </div>
        ) : null}

        {step === "form" && providerPreset?.implemented ? (
          <div className="space-y-3 max-w-md">
            <p className="text-sm text-muted-foreground">
              {provider === "SEZNAM"
                ? "IMAP imap.seznam.cz:993 (SSL), SMTP smtp.seznam.cz:465 (SSL). Při 2FA použijte heslo aplikace."
                : "Zadejte parametry IMAP a SMTP serveru."}
            </p>
            <div>
              <Label>E-mailová adresa</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <Label>Heslo / heslo aplikace</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label>Zobrazované jméno (volitelné)</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            {provider === "IMAP_SMTP" ? (
              <>
                <div>
                  <Label>IMAP server</Label>
                  <Input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
                </div>
                <div>
                  <Label>SMTP server</Label>
                  <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                </div>
              </>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void runTest()}>
                Otestovat připojení
              </Button>
              <Button type="button" disabled={busy} onClick={() => void connect()}>
                Připojit
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep("pick")}>
                Zpět
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
