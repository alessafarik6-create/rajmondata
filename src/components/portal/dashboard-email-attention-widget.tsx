"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@/firebase";
import { Mail, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DashboardCompactCard } from "@/components/portal/dashboard-compact-card";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { cn } from "@/lib/utils";

type Stats = {
  waitingReply: number;
  overdue: number;
  assignedToMe: number;
  urgent: number;
};

type PreviewMessage = {
  id: string;
  subject?: string | null;
  from?: string | null;
  receivedAt?: string | null;
  needsReply?: boolean;
  staleNeedsReply?: boolean;
  aiPriority?: string | null;
  attachmentCount?: number;
};

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "právě teď";
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `před ${h} h`;
  return new Date(t).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

function senderLabel(from: string | null | undefined): string {
  const s = String(from ?? "").trim();
  if (!s) return "—";
  const m = /<([^>]+)>/.exec(s);
  if (m?.[1]) return m[1];
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
}

export function DashboardEmailAttentionWidget({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { canRead } = usePortalModuleAccess("emails");
  const [stats, setStats] = useState<Stats | null>(null);
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !companyId || !canRead) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const [statsRes, msgRes] = await Promise.all([
          fetch(`/api/company/email-mailbox/stats?companyId=${encodeURIComponent(companyId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(
            `/api/company/email-mailbox/messages?companyId=${encodeURIComponent(companyId)}&view=inbox`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
        ]);
        const statsData = await statsRes.json();
        const msgData = await msgRes.json();
        if (cancelled) return;
        if (statsData.ok) {
          setStats({
            waitingReply: statsData.waitingReply ?? 0,
            overdue: statsData.overdue ?? 0,
            assignedToMe: statsData.assignedToMe ?? 0,
            urgent: statsData.urgent ?? 0,
          });
        }
        const list = Array.isArray(msgData.messages) ? (msgData.messages as PreviewMessage[]) : [];
        setMessages(list.slice(0, 5));
      } catch {
        if (!cancelled) {
          setStats(null);
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, companyId, canRead]);

  const previews = useMemo(() => {
    return [...messages]
      .sort((a, b) => {
        const ta = Date.parse(a.receivedAt ?? "") || 0;
        const tb = Date.parse(b.receivedAt ?? "") || 0;
        return tb - ta;
      })
      .slice(0, 5);
  }, [messages]);

  if (!canRead || !companyId) return null;

  return (
    <DashboardCompactCard
      title="E-maily"
      icon={<Mail className="h-4 w-4 text-sky-600" />}
      accentClass="border-l-sky-500"
      href="/portal/email"
      footerLabel="Otevřít e-mail"
    >
      {loading ? (
        <p className="text-xs text-muted-foreground py-4">Načítání…</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              Čeká na odpověď:{" "}
              <strong className="text-foreground">{stats?.waitingReply ?? 0}</strong>
            </span>
            <span>
              Po termínu: <strong className="text-foreground">{stats?.overdue ?? 0}</strong>
            </span>
          </div>
          {previews.length > 0 ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pt-1">
                Poslední e-maily
              </p>
              <ul className="space-y-1.5">
                {previews.map((m) => {
                  const urgent =
                    m.aiPriority === "urgent" ||
                    m.aiPriority === "high" ||
                    (stats?.urgent ?? 0) > 0 && m.needsReply;
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/portal/email?messageId=${encodeURIComponent(m.id)}`}
                        className={cn(
                          "block rounded-md border border-border/60 bg-muted/20 px-2 py-1.5",
                          "hover:bg-muted/50 transition-colors"
                        )}
                      >
                        <p className="truncate text-xs font-medium text-foreground">
                          {m.subject?.trim() || "(bez předmětu)"}
                        </p>
                        <div className="flex items-center justify-between gap-1 mt-0.5">
                          <span className="truncate text-[11px] text-muted-foreground">
                            {senderLabel(m.from)}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {formatRelative(m.receivedAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {m.needsReply || m.staleNeedsReply ? (
                            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                              čeká na odpověď
                            </Badge>
                          ) : null}
                          {urgent ? (
                            <Badge className="h-4 px-1 text-[9px] bg-orange-600 hover:bg-orange-600">
                              urgentní
                            </Badge>
                          ) : null}
                          {(m.attachmentCount ?? 0) > 0 ? (
                            <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[9px]">
                              <Paperclip className="h-2.5 w-2.5" />
                              {m.attachmentCount}
                            </Badge>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground pt-2">Žádné e-maily k zobrazení.</p>
          )}
        </div>
      )}
    </DashboardCompactCard>
  );
}
