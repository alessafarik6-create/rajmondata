"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Send, Flame } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiAssistantAvatar } from "@/components/ai/ai-assistant-avatar";
import { usePlatformAiBranding } from "@/contexts/platform-ai-branding-context";
import { cn } from "@/lib/utils";
import type { OrganizationAiBriefingItem } from "@/lib/ai/organization-ai-types";
import type { OrganizationAiEntityRef } from "@/lib/ai/organization-ai-entity-links";

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
  const [briefing, setBriefing] = useState<BriefingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [refs, setRefs] = useState<OrganizationAiEntityRef[]>([]);
  const [showAllItems, setShowAllItems] = useState(false);

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

  const visibleItems =
    briefing && (showAllItems ? briefing.items : briefing.items.slice(0, 5));

  return (
    <section className="rounded-lg border border-border bg-white shadow-sm p-3 sm:p-4 max-h-[360px] overflow-y-auto">
      <div className="flex gap-3 sm:gap-4">
        <AiAssistantAvatar size="xs" className="sm:hidden shrink-0 mt-0.5" />
        <AiAssistantAvatar size="sm" className="hidden sm:block shrink-0 mt-0.5" />

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {branding.assistantName}
              </p>
              <p className="text-xs text-slate-600">{branding.assistantSubtitle}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 border-orange-200 text-orange-700 hover:bg-orange-50"
              onClick={() => void ask("Co dnes hoří?")}
              disabled={asking}
            >
              <Flame className="h-3.5 w-3.5 mr-1" /> Co dnes hoří?
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-600 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Připravuji přehled…
            </div>
          ) : error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : briefing ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">{briefing.greeting}</p>
              <p className="text-xs text-slate-600">{briefing.intro}</p>
              {visibleItems && visibleItems.length > 0 ? (
                <ul className="space-y-0.5 pt-1">
                  {visibleItems.map((item, i) => (
                    <li key={i} className="flex gap-1.5 items-start text-xs text-slate-900">
                      <span className="shrink-0">{item.icon}</span>
                      {item.ref ? (
                        <Link
                          href={item.ref.href}
                          className={cn(
                            "hover:underline",
                            item.priority === "URGENT" && "text-orange-700 font-medium",
                            item.priority === "HIGH" && "text-orange-600"
                          )}
                        >
                          {item.text}
                        </Link>
                      ) : (
                        <span
                          className={cn(
                            item.priority === "URGENT" && "text-orange-700 font-medium",
                            item.priority === "HIGH" && "text-orange-600"
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
                  className="text-xs text-orange-600 hover:underline pt-0.5"
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
              className="h-9 text-sm bg-white border-slate-200"
              disabled={asking}
            />
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 shrink-0 bg-orange-600 hover:bg-orange-700"
              disabled={asking || !question.trim()}
            >
              {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                className="text-[11px] rounded-full border border-slate-200 px-2 py-0.5 text-slate-700 bg-slate-50 hover:bg-orange-50 hover:border-orange-200 transition-colors"
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
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 space-y-2">
              <p className="whitespace-pre-wrap leading-relaxed">{answer}</p>
              {refs.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {refs.map((r) => (
                    <Button key={`${r.type}-${r.id}`} asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link href={r.href}>{r.label}</Link>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
