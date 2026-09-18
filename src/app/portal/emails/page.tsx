"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import type { EmailMessageWorkflowView } from "@/lib/email-mailbox/types";
import { Loader2 } from "lucide-react";

const VIEWS: { id: EmailMessageWorkflowView; label: string }[] = [
  { id: "inbox", label: "Doručené" },
  { id: "waiting_reply", label: "Čeká na odpověď" },
  { id: "ai_review", label: "AI ke kontrole" },
  { id: "assigned", label: "Přiřazené" },
  { id: "unassigned", label: "Nepřiřazené" },
  { id: "resolved", label: "Vyřešené" },
];

type MsgRow = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string | null;
  needsReply?: boolean;
  staleNeedsReply?: boolean;
  aiSummary?: string | null;
  emailAccountId: string;
};

type MsgDetail = MsgRow & {
  textBody?: string | null;
  messageId?: string | null;
  aiDraftReply?: string | null;
  inquiryDraft?: Record<string, unknown> | null;
  jobId?: string | null;
  customerId?: string | null;
};

export default function PortalEmailsPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const access = usePortalModuleAccess("emails");
  const canWrite = access.canWrite;

  const [view, setView] = useState<EmailMessageWorkflowView>("inbox");
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MsgDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [assignJobId, setAssignJobId] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages?companyId=${encodeURIComponent(companyId)}&view=${view}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok) setMessages(data.messages ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, view, access]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!user || !companyId) return;
      setSelectedId(id);
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${id}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok) {
        setDetail(data.message as MsgDetail);
        setReplyText(String(data.message?.aiDraftReply ?? ""));
      }
    },
    [user, companyId]
  );

  const selectedStale = useMemo(
    () => messages.find((m) => m.id === selectedId)?.staleNeedsReply,
    [messages, selectedId]
  );

  async function aiDraft() {
    if (!user || !companyId || !selectedId || !canWrite) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${selectedId}/ai-draft?companyId=${encodeURIComponent(companyId)}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "AI draft selhal", description: data.error });
        return;
      }
      setReplyText(String(data.draft ?? ""));
      toast({ title: "Návrh odpovědi připraven" });
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!user || !companyId || !detail || !canWrite) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/email-mailbox/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          accountId: detail.emailAccountId,
          to: [detail.from.replace(/.*<([^>]+)>.*/, "$1").trim() || detail.from],
          subject: detail.subject,
          textBody: replyText,
          replyToMessageId: detail.id,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Odeslání selhalo", description: data.error });
        return;
      }
      toast({ title: "E-mail odeslán" });
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function assignJob() {
    if (!user || !companyId || !selectedId || !canWrite) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/email-mailbox/messages/${selectedId}/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, jobId: assignJobId.trim() || null }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Přiřazení selhalo", description: data.error });
        return;
      }
      toast({ title: "Přiřazeno k zakázce" });
      await loadList();
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  if (!access.canRead) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Nemáte oprávnění k modulu E-maily.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:flex-row lg:p-6">
      <aside className="w-full shrink-0 lg:w-56">
        <p className="mb-2 text-sm font-semibold">Složky</p>
        <nav className="flex flex-col gap-1">
          {VIEWS.map((v) => (
            <Button
              key={v.id}
              variant={view === v.id ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => setView(v.id)}
            >
              {v.label}
            </Button>
          ))}
        </nav>
        <Button variant="link" className="mt-4 px-0" asChild>
          <Link href="/portal/settings?tab=email-mailbox">Nastavení schránek</Link>
        </Button>
      </aside>

      <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Zprávy</CardTitle>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void loadList()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Obnovit"}
            </Button>
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-2 overflow-y-auto">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádné zprávy. Připojte schránku v nastavení a synchronizujte.</p>
            ) : (
              messages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`w-full rounded-md border p-2 text-left text-sm hover:bg-muted/50 ${
                    selectedId === m.id ? "border-primary" : ""
                  }`}
                  onClick={() => void loadDetail(m.id)}
                >
                  <p className="font-medium truncate">{m.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.from}</p>
                  {m.staleNeedsReply ? (
                    <p className="text-xs text-amber-600">Nezodpovězeno &gt; 48 h</p>
                  ) : null}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!detail ? (
              <p className="text-sm text-muted-foreground">Vyberte zprávu v seznamu.</p>
            ) : (
              <>
                <div>
                  <p className="font-semibold">{detail.subject}</p>
                  <p className="text-sm text-muted-foreground">{detail.from}</p>
                  {selectedStale ? (
                    <p className="text-sm text-amber-600">Upozornění: dlouho bez odpovědi.</p>
                  ) : null}
                </div>
                {detail.aiSummary ? (
                  <p className="rounded-md bg-muted p-2 text-sm">
                    <span className="font-medium">AI shrnutí: </span>
                    {detail.aiSummary}
                  </p>
                ) : null}
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border p-2 text-xs">
                  {detail.textBody ?? ""}
                </pre>
                {canWrite ? (
                  <>
                    <Textarea
                      rows={6}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Text odpovědi…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void aiDraft()}>
                        Navrhnout odpověď pomocí AI
                      </Button>
                      <Button size="sm" disabled={busy || !replyText.trim()} onClick={() => void sendReply()}>
                        Odeslat
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                      <div className="flex-1">
                        <Input
                          placeholder="ID zakázky (jobId)"
                          value={assignJobId}
                          onChange={(e) => setAssignJobId(e.target.value)}
                        />
                      </div>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void assignJob()}>
                        Přiřadit
                      </Button>
                    </div>
                    {detail.inquiryDraft ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link href="/portal/leads">Vytvořit poptávku (předvyplněno v AI draftu)</Link>
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Režim pouze pro čtení.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
