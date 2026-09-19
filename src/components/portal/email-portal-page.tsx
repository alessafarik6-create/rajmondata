"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { EmailConnectWizard } from "@/components/portal/email-connect-wizard";
import type { EmailMessageWorkflowView } from "@/lib/email-mailbox/types";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Mail, Plus, Sparkles, Search } from "lucide-react";

type AccountRow = {
  id: string;
  email: string;
  provider: string;
  status: string;
  lastSyncAt: string | null;
};

type MsgRow = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string | null;
  isRead?: boolean;
  needsReply?: boolean;
  staleNeedsReply?: boolean;
  customerName?: string | null;
  jobLabel?: string | null;
  emailAccountId: string;
};

type MsgDetail = MsgRow & {
  to?: string[];
  textBody?: string | null;
  aiSummary?: string | null;
  aiInsights?: string[] | null;
  aiDraftReply?: string | null;
  customerId?: string | null;
  jobId?: string | null;
  inquiryDraft?: Record<string, unknown> | null;
};

const FOLDERS: { id: EmailMessageWorkflowView; label: string }[] = [
  { id: "inbox", label: "Doručené" },
  { id: "sent", label: "Odeslané" },
  { id: "drafts", label: "Koncepty" },
  { id: "archive", label: "Archiv" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Koš" },
];

const ONBOARDING_BULLETS = [
  "příchozí a odeslané e-maily v RAJMONDATA",
  "přiřazení e-mailu k zákazníkovi",
  "přiřazení e-mailu k zakázce",
  "AI třídění komunikace",
  "AI návrhy odpovědí",
  "upozornění na nezodpovězené zprávy",
  "možnost vytvářet z e-mailu úkol",
  "hlídání důležitých termínů a požadavků",
  "vyhledávání v komunikaci",
];

export function EmailPortalPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const access = usePortalModuleAccess("emails");

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(searchParams.get("setup") === "1");
  const [folder, setFolder] = useState<EmailMessageWorkflowView>("inbox");
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MsgDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [replyText, setReplyText] = useState("");
  const [assignJobId, setAssignJobId] = useState("");
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [shareWithJob, setShareWithJob] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const activeAccountId = selectedAccountId || accounts[0]?.id || "";

  const getToken = useCallback(async () => {
    if (!user) throw new Error("Nepřihlášen");
    return user.getIdToken();
  }, [user]);

  const loadAccounts = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoadingAccounts(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/accounts?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ accounts?: AccountRow[] }>(res);
      if (data.ok) {
        const list = data.accounts ?? [];
        setAccounts(list);
        setSelectedAccountId((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev;
          return list[0]?.id ?? "";
        });
      }
      else if (data.message || data.error) {
        toast({ variant: "destructive", title: "Účty e-mailu", description: data.message ?? data.error });
      }
    } finally {
      setLoadingAccounts(false);
    }
  }, [user, companyId, access.canRead, getToken, toast]);

  const loadMessages = useCallback(async () => {
    if (!user || !companyId || !access.canRead || accounts.length === 0 || !activeAccountId) return;
    setLoadingList(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages?companyId=${encodeURIComponent(companyId)}&view=${folder}&accountId=${encodeURIComponent(activeAccountId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ messages?: MsgRow[] }>(res);
      if (data.ok) setMessages(data.messages ?? []);
    } finally {
      setLoadingList(false);
    }
  }, [user, companyId, folder, access.canRead, accounts.length, activeAccountId, getToken]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.from.toLowerCase().includes(q) ||
        (m.customerName ?? "").toLowerCase().includes(q)
    );
  }, [messages, search]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!user || !companyId) return;
      setSelectedId(id);
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${id}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ message?: MsgDetail }>(res);
      if (data.ok && data.message) {
        setDetail(data.message);
        setReplyText(String(data.message?.aiDraftReply ?? ""));
        setAssignJobId(String(data.message?.jobId ?? ""));
        setAssignCustomerId(String(data.message?.customerId ?? ""));
        if (access.canWrite) {
          await fetch(`/api/company/email-mailbox/messages/${id}/patch`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, isRead: true }),
          });
        }
      }
    },
    [user, companyId, getToken, access.canWrite]
  );

  async function syncNow() {
    if (!activeAccountId || !companyId) return;
    setBusy(true);
    toast({ title: "Synchronizuji…", description: "Stahuji nové zprávy z IMAP." });
    try {
      const token = await getToken();
      const res = await fetch(`/api/company/email-mailbox/accounts/${activeAccountId}/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, maxMessages: 100 }),
      });
      const data = await parseEmailApiResponse<{ imported?: number }>(res);
      if (!data.ok) {
        toast({
          variant: "destructive",
          title: "Synchronizace selhala",
          description: data.message ?? data.error,
        });
        return;
      }
      toast({
        title: "Synchronizace dokončena",
        description: data.message ?? `Synchronizováno – ${data.imported ?? 0} nových zpráv.`,
      });
      await loadMessages();
      await loadAccounts();
    } finally {
      setBusy(false);
    }
  }

  async function aiDraft() {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${selectedId}/ai-draft?companyId=${encodeURIComponent(companyId)}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "AI návrh selhal", description: data.error });
        return;
      }
      setReplyText(String(data.draft ?? ""));
    } finally {
      setBusy(false);
    }
  }

  async function sendMail(opts: { reply?: boolean; forward?: boolean }) {
    if (!companyId || !activeAccountId || !access.canWrite) return;
    const to = opts.reply && detail
      ? [detail.from.replace(/.*<([^>]+)>.*/, "$1").trim() || detail.from]
      : composeTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const subject = opts.reply ? detail!.subject : composeSubject;
    const text = opts.reply ? replyText : composeBody;
    if (!to.length || !text.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/company/email-mailbox/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          accountId: detail?.emailAccountId ?? activeAccountId,
          to,
          subject,
          textBody: text,
          replyToMessageId: opts.reply ? detail?.id : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Odeslání selhalo", description: data.error });
        return;
      }
      toast({ title: "E-mail odeslán" });
      setComposeOpen(false);
      await loadMessages();
    } finally {
      setBusy(false);
    }
  }

  async function assignLinks() {
    if (!selectedId || !companyId) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fetch(`/api/company/email-mailbox/messages/${selectedId}/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          jobId: assignJobId.trim() || null,
          customerId: assignCustomerId.trim() || null,
          shareWithJob: shareWithJob && Boolean(assignJobId.trim()),
        }),
      });
      toast({ title: "Přiřazení uloženo" });
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  if (!access.canRead) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Nemáte oprávnění k modulu E-mail.</p>
      </div>
    );
  }

  if (loadingAccounts) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0 || wizardOpen) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        {!wizardOpen ? (
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mail className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl">Moje pošta</CardTitle>
              <p className="text-muted-foreground">
                Připojte svůj pracovní e-mail a spravujte vlastní komunikaci se zákazníky přímo u zakázek.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {access.canWrite ? (
                <Button size="lg" className="gap-2" onClick={() => setWizardOpen(true)}>
                  <Plus className="h-4 w-4" /> Připojit e-mailovou schránku
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nemáte oprávnění připojit schránku. Požádejte administrátora o přístup k modulu E-mail.
                </p>
              )}
              <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                {ONBOARDING_BULLETS.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button variant="link" className="px-0" asChild>
                <Link href="/portal/settings">Nastavení → Profil → Můj e-mail</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Připojit schránku</CardTitle>
            </CardHeader>
            <CardContent>
              {companyId && access.canWrite ? (
                <EmailConnectWizard
                  companyId={companyId}
                  getToken={getToken}
                  onConnected={() => {
                    setWizardOpen(false);
                    void loadAccounts();
                  }}
                  onCancel={() => setWizardOpen(false)}
                />
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b lg:w-52 lg:border-b-0 lg:border-r p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Moje pošta</p>
        {accounts.length > 1 ? (
          <Select value={activeAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="mb-3 w-full">
              <SelectValue placeholder="Schránka" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="mb-3 truncate text-sm font-medium">{accounts[0]?.email}</p>
        )}
        <Button className="mb-3 w-full gap-2" disabled={!access.canWrite} onClick={() => setComposeOpen(true)}>
          <Plus className="h-4 w-4" /> Nový e-mail
        </Button>
        <nav className="flex flex-row flex-wrap gap-1 lg:flex-col">
          {FOLDERS.map((f) => (
            <Button
              key={f.id}
              variant={folder === f.id ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => setFolder(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </nav>
        <Button variant="outline" size="sm" className="mt-4 w-full" disabled={busy} onClick={() => void syncNow()}>
          Synchronizovat
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <div
          className={cn(
            "min-w-0 border-b lg:w-[min(100%,22rem)] lg:border-b-0 lg:border-r flex flex-col",
            selectedId && "hidden lg:flex"
          )}
        >
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Hledat…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-[50vh] lg:max-h-none flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-4 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Žádné zprávy.</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={cn(
                    "w-full border-b px-3 py-2 text-left text-sm hover:bg-muted/50",
                    selectedId === m.id && "bg-muted",
                    !m.isRead && "font-semibold"
                  )}
                  onClick={() => void loadDetail(m.id)}
                >
                  <p className="truncate">{m.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.from}</p>
                  {m.staleNeedsReply ? (
                    <p className="text-xs text-amber-600">Čeká na odpověď</p>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        <div className={cn("min-w-0 flex-1 p-3 sm:p-4", !selectedId && "hidden lg:block")}>
          {composeOpen ? (
            <div className="space-y-3 max-w-xl">
              <h2 className="font-semibold">Nový e-mail</h2>
              <Input placeholder="Komu" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
              <Input placeholder="Předmět" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
              <Textarea rows={8} value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void sendMail({})}>
                  Odeslat
                </Button>
                <Button variant="ghost" onClick={() => setComposeOpen(false)}>
                  Zrušit
                </Button>
              </div>
            </div>
          ) : !detail ? (
            <p className="text-muted-foreground text-sm">Vyberte zprávu v seznamu.</p>
          ) : (
            <div className="space-y-4 max-w-3xl">
              <Button variant="ghost" size="sm" className="lg:hidden -ml-2" onClick={() => setSelectedId(null)}>
                ← Zpět
              </Button>
              <div>
                <h1 className="text-lg font-semibold break-words">{detail.subject}</h1>
                <p className="text-sm text-muted-foreground break-all">Od: {detail.from}</p>
                <p className="text-xs text-muted-foreground">
                  {detail.receivedAt ? new Date(detail.receivedAt).toLocaleString("cs-CZ") : ""}
                </p>
              </div>
              {detail.customerName || detail.customerId ? (
                <div className="rounded-md border p-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">Zákazník: </span>
                    {detail.customerName ?? detail.customerId}
                  </p>
                  {detail.customerId ? (
                    <Button size="sm" variant="link" className="px-0 h-auto" asChild>
                      <Link href={`/portal/customers/${detail.customerId}`}>Otevřít zákazníka</Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {detail.jobLabel || detail.jobId ? (
                <div className="rounded-md border p-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">Zakázka: </span>
                    {detail.jobLabel ?? detail.jobId}
                  </p>
                  {detail.jobId ? (
                    <Button size="sm" variant="link" className="px-0 h-auto" asChild>
                      <Link href={`/portal/jobs/${detail.jobId}`}>Otevřít zakázku</Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {detail.aiSummary ? (
                <p className="rounded-md bg-muted p-3 text-sm">{detail.aiSummary}</p>
              ) : null}
              {(detail.aiInsights ?? []).map((line) => (
                <p key={line} className="text-sm text-amber-800 dark:text-amber-200">
                  {line}
                </p>
              ))}
              <div className="whitespace-pre-wrap break-words text-sm border rounded-md p-3 max-h-[40vh] overflow-y-auto">
                {detail.textBody}
              </div>
              {access.canWrite ? (
                <>
                  <Textarea rows={5} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void aiDraft()}>
                      <Sparkles className="h-4 w-4 mr-1" /> Navrhnout odpověď pomocí AI
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void sendMail({ reply: true })}>
                      Odpovědět
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setComposeTo("");
                        setComposeSubject(`Fwd: ${detail.subject}`);
                        setComposeBody(`\n\n---------- Přeposlaná zpráva ----------\n${detail.textBody ?? ""}`);
                        setComposeOpen(true);
                      }}
                    >
                      Přeposlat
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 border-t pt-4">
                    <Input
                      placeholder="ID zákazníka"
                      value={assignCustomerId}
                      onChange={(e) => setAssignCustomerId(e.target.value)}
                    />
                    <Input placeholder="ID zakázky" value={assignJobId} onChange={(e) => setAssignJobId(e.target.value)} />
                    <label className="flex items-center gap-2 text-sm col-span-full">
                      <Checkbox
                        checked={shareWithJob}
                        onCheckedChange={(v) => setShareWithJob(Boolean(v))}
                        disabled={!assignJobId.trim()}
                      />
                      Zveřejnit obsah komunikace u zakázky (jinak zůstane soukromá)
                    </label>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void assignLinks()}>
                      Přiřadit
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/portal/leads">Vytvořit poptávku</Link>
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
