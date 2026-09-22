"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Send, Flame, ChevronDown, ChevronUp } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiAssistantAvatar } from "@/components/ai/ai-assistant-avatar";
import { usePlatformAiBranding } from "@/contexts/platform-ai-branding-context";
import { cn } from "@/lib/utils";
import type { OrganizationAiBriefingItem } from "@/lib/ai/organization-ai-types";
import type { OrganizationAiEntityRef } from "@/lib/ai/organization-ai-entity-links";
import { useIsBelowLg, useIsMobile } from "@/hooks/use-mobile";
import { usePortalUserPreferences } from "@/hooks/use-portal-user-preferences";

type BriefingState = {
  greeting: string;
  intro: string;
  items: OrganizationAiBriefingItem[];
  attentionCount: number;
};

const QUICK = [
  { label: "Zakázky", q: "Které zakázky jsou po termínu?" },
  { label: "Finance", q: "Jaké faktury jsou po splatnosti?" },
  { label: "E-maily", q: "Na které e-maily jsme ještě neodpověděli?" },
  { label: "Výroba", q: "Co se dnes děje ve výrobě?" },
];

export function DashboardAiSecretaryPanel({ companyId }: { companyId: string }) {
  const { user } = useUser();
  const { branding } = usePlatformAiBranding();
  const belowLg = useIsBelowLg();
  const isPhone = useIsMobile();
  const { preferences, isLoading: prefsLoading, setAiSecretaryCollapsed } = usePortalUserPreferences();

  const [briefing, setBriefing] = useState<BriefingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [refs, setRefs] = useState<OrganizationAiEntityRef[]>([]);
  const [showAllItems, setShowAllItems] = useState(false);

  const prefCollapsed = preferences.aiSecretaryCollapsed;
  const collapsed =
    prefCollapsed !== undefined ? prefCollapsed : isPhone ? true : false;

  const loadBriefing = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/ai/dashboard/briefing?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "AI přehled se nyní nepodařilo připravit.");
        return;
      }
      setBriefing({
        greeting: data.greeting,
        intro: data.intro,
        items: data.items ?? [],
        attentionCount: data.attentionCount ?? 0,
      });
    } catch {
      setError("AI přehled se nyní nepodařilo připravit.");
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void loadBriefing();
  }, [loadBriefing]);

  const ask = useCallback(
    async (q: string) => {
      if (!user || !q.trim()) return;
      setAsking(true);
      setAnswer(null);
      setRefs([]);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/company/ai/dashboard/ask", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ companyId, question: q.trim() }),
        });
        const data = await res.json();
        if (data.ok) {
          setAnswer(data.answer);
          setRefs(data.references ?? []);
        } else {
          setAnswer(data.error ?? "Odpověď se nepodařila načíst.");
        }
      } finally {
        setAsking(false);
      }
    },
    [user, companyId]
  );

  const toggleCollapsed = () => {
    const next = !collapsed;
    void setAiSecretaryCollapsed(next);
  };

  const visibleItems =
    briefing && (showAllItems ? briefing.items : briefing.items.slice(0, 5));

  const mobileDark = belowLg;

  return (
    <section
      className={cn(
        "rounded-2xl border shadow-sm transition-[max-height]",
        mobileDark
          ? "border-white/10 bg-white/[0.04] text-slate-50 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur"
          : "border-border bg-white max-h-[360px] overflow-y-auto",
        mobileDark && collapsed ? "p-3 min-h-[72px] max-h-none overflow-hidden" : "p-3 sm:p-4",
        mobileDark && !collapsed ? "max-h-none overflow-visible" : !mobileDark && "max-h-[360px] overflow-y-auto"
      )}
    >
      <div className={cn("flex gap-3 sm:gap-4", mobileDark && collapsed && "items-center")}>
        <AiAssistantAvatar size="xs" className="sm:hidden shrink-0 mt-0.5" />
        <AiAssistantAvatar size="sm" className="hidden sm:block shrink-0 mt-0.5" />

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold truncate",
                  mobileDark ? "text-white" : "text-slate-900"
                )}
              >
                {branding.assistantName}
              </p>
              <p className={cn("text-xs", mobileDark ? "text-slate-400" : "text-slate-600")}>
                {branding.assistantSubtitle}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {mobileDark ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-orange-300 hover:bg-white/10 hover:text-orange-200"
                  onClick={toggleCollapsed}
                  disabled={prefsLoading}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? "Rozbalit AI sekretářku" : "Sbalit AI sekretářku"}
                >
                  {collapsed ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronUp className="h-5 w-5" />
                  )}
                </Button>
              ) : null}
              {!mobileDark || !collapsed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-8 shrink-0",
                    mobileDark
                      ? "border-orange-500/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20"
                      : "border-orange-200 text-orange-700 hover:bg-orange-50"
                  )}
                  onClick={() => void ask("Co dnes hoří?")}
                  disabled={asking}
                >
                  <Flame className="h-3.5 w-3.5 mr-1" /> Co dnes hoří?
                </Button>
              ) : null}
            </div>
          </div>

          {(mobileDark && collapsed) ? null : (
            <>
              {loading ? (
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs py-2",
                    mobileDark ? "text-slate-400" : "text-slate-600"
                  )}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Připravuji přehled…
                </div>
              ) : error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : briefing ? (
                <div className="space-y-1">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      mobileDark ? "text-white" : "text-slate-900"
                    )}
                  >
                    {briefing.greeting}
                  </p>
                  <p className={cn("text-xs", mobileDark ? "text-slate-400" : "text-slate-600")}>
                    {briefing.intro}
                  </p>
                  {visibleItems && visibleItems.length > 0 ? (
                    <ul className="space-y-0.5 pt-1">
                      {visibleItems.map((item, i) => (
                        <li
                          key={i}
                          className={cn(
                            "flex gap-1.5 items-start text-xs",
                            mobileDark ? "text-slate-100" : "text-slate-900"
                          )}
                        >
                          <span className="shrink-0">{item.icon}</span>
                          {item.ref ? (
                            <Link
                              href={item.ref.href}
                              className={cn(
                                "hover:underline",
                                item.priority === "URGENT" && "text-orange-400 font-medium",
                                item.priority === "HIGH" && "text-orange-300",
                                !mobileDark &&
                                  item.priority === "URGENT" &&
                                  "text-orange-700",
                                !mobileDark && item.priority === "HIGH" && "text-orange-600"
                              )}
                            >
                              {item.text}
                            </Link>
                          ) : (
                            <span
                              className={cn(
                                item.priority === "URGENT" && "text-orange-400 font-medium",
                                item.priority === "HIGH" && "text-orange-300",
                                !mobileDark &&
                                  item.priority === "URGENT" &&
                                  "text-orange-700",
                                !mobileDark && item.priority === "HIGH" && "text-orange-600"
                              )}
                            >
                              {item.text}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {briefing.items.length > 5 && !showAllItems ? (
                    <button
                      type="button"
                      className="text-xs text-orange-400 hover:underline pt-0.5"
                      onClick={() => setShowAllItems(true)}
                    >
                      Zobrazit všechny důležité události
                    </button>
                  ) : null}
                </div>
              ) : null}

              <form
                className="flex gap-2 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(question);
                }}
              >
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Zeptejte se na firmu…"
                  className={cn(
                    "h-9 text-sm",
                    mobileDark
                      ? "bg-slate-900/60 border-white/15 text-white placeholder:text-slate-500"
                      : "bg-white border-slate-200"
                  )}
                  disabled={asking}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="h-9 w-9 shrink-0 bg-orange-600 hover:bg-orange-700"
                  disabled={asking || !question.trim()}
                >
                  {asking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>

              <div className="flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    className={cn(
                      "text-[11px] rounded-full border px-2 py-0.5 transition-colors",
                      mobileDark
                        ? "border-white/15 bg-white/5 text-slate-200 hover:border-orange-500/40 hover:bg-orange-500/10"
                        : "border-slate-200 px-2 py-0.5 text-slate-700 bg-slate-50 hover:bg-orange-50 hover:border-orange-200"
                    )}
                    onClick={() => {
                      setQuestion(q.q);
                      void ask(q.q);
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>

              {answer ? (
                <div
                  className={cn(
                    "rounded-md border p-2.5 text-xs space-y-2",
                    mobileDark
                      ? "border-white/10 bg-black/20 text-slate-100"
                      : "border-slate-200 bg-slate-50 text-slate-900"
                  )}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{answer}</p>
                  {refs.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {refs.map((r) => (
                        <Button
                          key={`${r.type}-${r.id}`}
                          asChild
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                        >
                          <Link href={r.href}>{r.label}</Link>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
