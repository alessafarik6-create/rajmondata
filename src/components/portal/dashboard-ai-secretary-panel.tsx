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
  { label: "Co dnes hoří?", q: "Co dnes hoří?" },
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

  const onHot = () => void ask("Co dnes hoří?");

  return (
    <section className="rounded-xl border border-primary/20 bg-gradient-to-br from-violet-50/90 via-white to-indigo-50/80 dark:from-slate-900 dark:via-slate-950 dark:to-indigo-950/40 p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-4">
        <AiAssistantAvatar size="md" className="sm:hidden self-start" />
        <AiAssistantAvatar size="lg" className="hidden sm:block" />

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 flex items-center gap-1">
              ✦ {branding.assistantName}
            </p>
            <p className="text-sm text-muted-foreground">{branding.assistantSubtitle}</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              RAJMONDATA AI připravuje přehled firmy…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : briefing ? (
            <>
              <p className="text-base font-medium text-foreground">{briefing.greeting}</p>
              <p className="text-sm text-muted-foreground">{briefing.intro}</p>
              {briefing.items.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {briefing.items.slice(0, 6).map((item, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span>{item.icon}</span>
                      {item.ref ? (
                        <Link href={item.ref.href} className="hover:underline text-foreground">
                          {item.text}
                        </Link>
                      ) : (
                        <span>{item.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onHot} disabled={asking}>
              <Flame className="h-4 w-4 mr-1 text-orange-600" /> Co dnes hoří?
            </Button>
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Zeptejte se na cokoli o firmě…"
              className="bg-background/80"
              disabled={asking}
            />
            <Button type="submit" size="icon" disabled={asking || !question.trim()}>
              {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                className={cn(
                  "text-xs rounded-full border px-2.5 py-1 bg-background/60 hover:bg-muted transition-colors"
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
            <div className="rounded-lg border bg-background/80 p-3 text-sm space-y-2">
              <p className="whitespace-pre-wrap">{answer}</p>
              {refs.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {refs.map((r) => (
                    <Button key={`${r.type}-${r.id}`} asChild size="sm" variant="outline">
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
