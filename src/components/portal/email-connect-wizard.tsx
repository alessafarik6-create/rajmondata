"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { EMAIL_PROVIDER_PRESETS, SEZNAM_IMAP_SMTP } from "@/lib/email-mailbox/provider-presets";
import type { EmailProviderKind } from "@/lib/email-mailbox/types";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Props = {
  companyId: string;
  getToken: () => Promise<string>;
  onConnected: () => void;
  onCancel?: () => void;
  initialProvider?: EmailProviderKind;
};

export function EmailConnectWizard({
  companyId,
  getToken,
  onConnected,
  onCancel,
  initialProvider = "SEZNAM",
}: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "form">(initialProvider ? "form" : "pick");
  const [provider, setProvider] = useState<EmailProviderKind>(initialProvider);
  const preset = useMemo(() => EMAIL_PROVIDER_PRESETS.find((p) => p.provider === provider), [provider]);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState<string>(SEZNAM_IMAP_SMTP.imapHost);
  const [imapPort, setImapPort] = useState(String(SEZNAM_IMAP_SMTP.imapPort));
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState<string>(SEZNAM_IMAP_SMTP.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(SEZNAM_IMAP_SMTP.smtpPort));
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [testOk, setTestOk] = useState(false);
  const [testLines, setTestLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function applyPreset(p: EmailProviderKind) {
    const pr = EMAIL_PROVIDER_PRESETS.find((x) => x.provider === p);
    if (!pr?.implemented) return;
    setProvider(p);
    setImapHost(pr.imapHost || "");
    setImapPort(String(pr.imapPort));
    setImapSecure(pr.imapSecure);
    setSmtpHost(pr.smtpHost || "");
    setSmtpPort(String(pr.smtpPort));
    setSmtpSecure(pr.smtpSecure);
    setTestOk(false);
    setStep("form");
  }

  async function api(path: string, body: unknown) {
    const token = await getToken();
    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseEmailApiResponse(res);
  }

  async function runTest() {
    setBusy(true);
    setTestOk(false);
    setTestLines([]);
    try {
      const data = await api("/api/company/email-mailbox/accounts/test", {
        provider,
        email,
        username: username || email,
        password,
        imapHost,
        imapPort: Number(imapPort),
        imapSecure,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure,
      });
      if (!data.ok) {
        const t = data.test as { imapOk?: boolean; smtpOk?: boolean } | undefined;
        const lines: string[] = [];
        if (t?.imapOk === false) lines.push("✗ IMAP – přihlášení selhalo");
        if (t?.smtpOk === false) lines.push("✗ SMTP – přihlášení selhalo");
        if (lines.length === 0) lines.push(String(data.message ?? data.error ?? "Test selhal"));
        setTestLines(lines);
        toast({
          variant: "destructive",
          title: "Test selhal",
          description: String(data.message ?? data.error ?? ""),
        });
        return;
      }
      setTestOk(true);
      setTestLines(["✓ IMAP připojení úspěšné", "✓ SMTP připojení úspěšné"]);
      toast({ title: "Připojení v pořádku", description: String(data.message ?? "IMAP i SMTP OK.") });
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!testOk) {
      toast({ variant: "destructive", title: "Nejdříve otestujte připojení" });
      return;
    }
    setBusy(true);
    try {
      const data = await api("/api/company/email-mailbox/accounts", {
        companyId,
        provider,
        email,
        username: username || email,
        password,
        imapHost,
        imapPort: Number(imapPort),
        imapSecure,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure,
      });
      if (!data.ok) {
        toast({ variant: "destructive", title: "Nepodařilo se připojit", description: String(data.error ?? "") });
        return;
      }
      toast({
        title: "Schránka připojena",
        description: String(data.message ?? "Probíhá synchronizace…"),
      });
      onConnected();
      const redirect = String((data as { redirectTo?: string }).redirectTo ?? "/portal/email");
      router.push(redirect);
    } finally {
      setBusy(false);
    }
  }

  if (step === "pick") {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium">Vyberte poskytovatele</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {EMAIL_PROVIDER_PRESETS.map((p) => (
            <Button
              key={p.provider}
              type="button"
              variant={p.implemented ? "secondary" : "outline"}
              disabled={!p.implemented}
              className="h-auto flex-col items-start py-3"
              onClick={() => applyPreset(p.provider)}
            >
              <span>{p.label}</span>
              {!p.implemented ? (
                <span className="text-xs text-muted-foreground">{p.comingSoonLabel ?? "Připravujeme"}</span>
              ) : null}
            </Button>
          ))}
        </div>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Zrušit
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        {provider === "SEZNAM"
          ? "Seznam.cz: IMAP imap.seznam.cz:993 (SSL), SMTP smtp.seznam.cz:465 (SSL). Při dvoufázovém ověření použijte heslo aplikace."
          : preset?.label}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>E-mail</Label>
          <Input value={email} onChange={(e) => { setEmail(e.target.value); setTestOk(false); }} />
        </div>
        <div className="sm:col-span-2">
          <Label>Uživatelské jméno</Label>
          <Input
            placeholder="Obvykle celá e-mailová adresa"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setTestOk(false); }}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Heslo / heslo aplikace</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setTestOk(false); }}
            autoComplete="new-password"
          />
        </div>
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Příchozí pošta – IMAP</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label>Server</Label>
            <Input value={imapHost} onChange={(e) => setImapHost(e.target.value)} disabled={provider === "SEZNAM"} />
          </div>
          <div>
            <Label>Port</Label>
            <Input value={imapPort} onChange={(e) => setImapPort(e.target.value)} disabled={provider === "SEZNAM"} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={imapSecure} onCheckedChange={setImapSecure} disabled={provider === "SEZNAM"} />
          <span className="text-sm">SSL/TLS</span>
        </div>
      </div>
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Odchozí pošta – SMTP</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label>Server</Label>
            <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} disabled={provider === "SEZNAM"} />
          </div>
          <div>
            <Label>Port</Label>
            <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} disabled={provider === "SEZNAM"} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={smtpSecure} onCheckedChange={setSmtpSecure} disabled={provider === "SEZNAM"} />
          <span className="text-sm">SSL/TLS</span>
        </div>
      </div>
      {testLines.length > 0 ? (
        <ul className="text-sm space-y-1 rounded-md border p-3 bg-muted/30">
          {testLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void runTest()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Otestovat připojení"}
        </Button>
        <Button type="button" disabled={busy || !testOk} onClick={() => void connect()}>
          Připojit schránku
        </Button>
        <Button type="button" variant="ghost" onClick={() => setStep("pick")}>
          Zpět
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Zrušit
          </Button>
        ) : null}
      </div>
    </div>
  );
}
