"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useFirestore, useUser } from "@/firebase";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type SupportChatMode = "organization" | "admin";

type MsgRow = {
  id: string;
  senderRole: string;
  message: string;
  createdAt?: Date | null;
};

function parseCreatedAt(raw: unknown): Date | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "toDate" in raw && typeof (raw as { toDate: () => Date }).toDate === "function") {
    try {
      return (raw as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

export function SupportChat({
  ticketId,
  mode,
  ticketStatus,
}: {
  ticketId: string;
  mode: SupportChatMode;
  /** U režimu admin zobrazení stavu z rodiče (aktualizuje se pollingem). */
  ticketStatus?: string;
}) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const [rows, setRows] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(mode === "admin");
  const [orgReady, setOrgReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const messagesPath = useMemo(
    () => [SUPPORT_TICKETS_COLLECTION, ticketId, "messages"] as const,
    [ticketId]
  );

  useEffect(() => {
    setOrgReady(false);
  }, [ticketId, mode]);

  useEffect(() => {
    if (mode !== "organization" || !firestore) return;
    const q = query(collection(firestore, ...messagesPath), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setOrgReady(true);
        setRows(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              senderRole: String(x.senderRole || ""),
              message: String(x.message || ""),
              createdAt: parseCreatedAt(x.createdAt),
            };
          })
        );
      },
      (err) => {
        console.error("[SupportChat] onSnapshot", err);
        toast({
          variant: "destructive",
          title: "Nelze načíst zprávy",
          description: err.message,
        });
      }
    );
    return () => unsub();
  }, [firestore, mode, messagesPath, toast]);

  const loadAdminMessages = useCallback(async () => {
    if (mode !== "admin") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/superadmin/support-tickets/${encodeURIComponent(ticketId)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      const list = Array.isArray(data.messages) ? data.messages : [];
      setRows(
        list.map((m: { id?: string; senderRole?: string; message?: string; createdAt?: string | null }) => ({
          id: String(m.id || ""),
          senderRole: String(m.senderRole || ""),
          message: String(m.message || ""),
          createdAt: m.createdAt ? new Date(m.createdAt) : null,
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [mode, ticketId, toast]);

  useEffect(() => {
    if (mode !== "admin") return;
    void loadAdminMessages();
    const id = window.setInterval(() => void loadAdminMessages(), 6000);
    return () => window.clearInterval(id);
  }, [mode, loadAdminMessages]);

  const sendOrg = async () => {
    if (!user) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/support-tickets/${encodeURIComponent(ticketId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: text }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Odeslání se nezdařilo",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      setDraft("");
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
    } finally {
      setSending(false);
    }
  };

  const sendAdmin = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch(`/api/superadmin/support-tickets/${encodeURIComponent(ticketId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Odeslání se nezdařilo",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      setDraft("");
      await loadAdminMessages();
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
    } finally {
      setSending(false);
    }
  };

  const closed = String(ticketStatus || "") === "closed";

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      {mode === "admin" && ticketStatus ? (
        <p className="text-sm text-muted-foreground">
          Stav ticketu: <span className="font-medium text-foreground">{ticketStatus}</span>
        </p>
      ) : null}
      <div className="min-h-[200px] max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {mode === "organization" && !orgReady ? (
          <p className="text-sm text-muted-foreground">Načítám zprávy…</p>
        ) : null}
        {mode === "organization" && orgReady && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádné zprávy.</p>
        ) : null}
        {mode === "admin" && loading && rows.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {rows.map((m) => {
          const isAdmin = m.senderRole === "admin";
          return (
            <div
              key={m.id}
              className={cn("flex", isAdmin ? "justify-start" : "justify-end")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  isAdmin
                    ? "bg-muted text-foreground"
                    : "bg-primary text-primary-foreground"
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.message}</p>
                <p className={cn("mt-1 text-[10px] opacity-80", isAdmin ? "" : "text-primary-foreground/80")}>
                  {isAdmin ? "Provozovatel" : "Vaše organizace"}
                  {m.createdAt ? ` · ${m.createdAt.toLocaleString("cs-CZ")}` : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {closed ? (
        <p className="text-sm text-muted-foreground">Tento ticket je uzavřený — nelze přidávat zprávy.</p>
      ) : (
        <div className="space-y-2 border-t border-border pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === "admin" ? "Odpověď pro organizaci…" : "Napište zprávu…"}
            rows={3}
            className="resize-none"
          />
          <Button
            type="button"
            disabled={sending || !draft.trim()}
            onClick={() => void (mode === "admin" ? sendAdmin() : sendOrg())}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Odeslat"}
          </Button>
        </div>
      )}
    </div>
  );
}
