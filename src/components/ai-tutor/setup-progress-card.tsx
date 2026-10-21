"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, X } from "lucide-react";
import { AI_SETUP_CHECKLIST } from "@/lib/ai-tutor/tutorial-registry";
import type { AiOrgMilestoneId } from "@/lib/ai-tutor/types";
import { dispatchStartAiTutorial } from "@/components/ai-tutor/ai-tutor-shell";

const HIDE_KEY = "rajmondata_setup_card_hidden";

type Milestones = Record<AiOrgMilestoneId, boolean>;

export function SetupProgressCard() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const [hidden, setHidden] = useState(false);
  const [milestones, setMilestones] = useState<Milestones | null>(null);
  const [tutorials, setTutorials] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(HIDE_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    const token = await user.getIdToken();
    const res = await fetch(`/api/company/ai-tutor/progress?companyId=${encodeURIComponent(companyId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (json.ok) {
      setMilestones(json.milestones);
      setTutorials(json.tutorials ?? []);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = AI_SETUP_CHECKLIST;
  const doneCount = useMemo(() => {
    if (!milestones) return 0;
    return items.filter((i) => milestones[i.id]).length;
  }, [milestones, items]);

  const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const next = items.find((i) => milestones && !milestones[i.id]);

  if (hidden || !milestones || percent >= 100) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Nastavení vaší firmy
        </CardTitle>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Skrýt kartu"
          onClick={() => {
            setHidden(true);
            try {
              sessionStorage.setItem(HIDE_KEY, "1");
            } catch {
              /* ignore */
            }
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{doneCount} / {items.length} kroků</span>
            <span>{percent} %</span>
          </div>
          <Progress value={percent} />
        </div>
        <ul className="space-y-1 text-muted-foreground">
          {items.map((i) => (
            <li key={i.id} className={milestones[i.id] ? "line-through opacity-70" : ""}>
              {milestones[i.id] ? "✓ " : "○ "}
              {i.label}
            </li>
          ))}
        </ul>
        {next ? (
          <p className="text-foreground">
            Doporučený další krok: <strong>{next.label}</strong>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const tid =
                next?.id === "first_job_created"
                  ? "first-job"
                  : next?.id === "first_customer_created"
                    ? "first-customer"
                    : tutorials[0]?.id ?? "first-job";
              dispatchStartAiTutorial(tid);
            }}
          >
            Pokračovat s AI
          </Button>
          {next?.href ? (
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={next.href}>Otevřít modul</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
