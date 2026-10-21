"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { InteractiveTour } from "@/components/ai-tutor/interactive-tour";
import { getTutorialById } from "@/lib/ai-tutor/tutorial-registry";
import { aiTutorSectionHint } from "@/lib/ai-tutor/section-hints";
import type { AiTutorialProgressDoc } from "@/lib/ai-tutor/types";
type Props = {
  enabled: boolean;
  onStartTutorialRef?: (fn: (id: string) => void) => void;
};

export function AiAssistantTutorPanel({ enabled, onStartTutorialRef }: Props) {
  const { user } = useUser();
  const { companyId } = useCompany();
  const pathname = usePathname() ?? "";
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<AiTutorialProgressDoc[]>([]);
  const [tutorials, setTutorials] = useState<{ id: string; title: string; summary: string }[]>([]);
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [ask, setAsk] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askReply, setAskReply] = useState<string | null>(null);

  const activeTutorial = activeTutorialId ? getTutorialById(activeTutorialId) : null;
  const sectionHint = useMemo(() => aiTutorSectionHint(pathname), [pathname]);

  const load = useCallback(async () => {
    if (!user || !companyId || !enabled) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/ai-tutor/progress?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.ok) {
        setProgress(json.progress ?? []);
        setTutorials(json.tutorials ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchProgress = async (
    tutorialId: string,
    patch: { status: AiTutorialProgressDoc["status"]; completedSteps?: string[]; lastStep?: string | null }
  ) => {
    if (!user || !companyId) return;
    const token = await user.getIdToken();
    await fetch("/api/company/ai-tutor/progress", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, tutorialId, ...patch }),
    });
    await load();
  };

  const startTutorial = useCallback(
    async (id: string) => {
      setActiveTutorialId(id);
      setStepIndex(0);
      await patchProgress(id, { status: "in_progress", completedSteps: [], lastStep: null });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, companyId]
  );

  useEffect(() => {
    onStartTutorialRef?.(startTutorial);
    const fn = (e: Event) => {
      const id = (e as CustomEvent<{ tutorialId: string }>).detail?.tutorialId;
      if (id) void startTutorial(id);
    };
    window.addEventListener("rajmondata:start-ai-tutorial", fn);
    return () => window.removeEventListener("rajmondata:start-ai-tutorial", fn);
  }, [onStartTutorialRef, startTutorial]);

  const submitAsk = async () => {
    if (!user || !companyId || !ask.trim()) return;
    setAskBusy(true);
    setAskReply(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai-tutor/ask", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, question: ask.trim(), pathname }),
      });
      const json = await res.json();
      if (json.ok) {
        setAskReply(json.answer);
        if (json.suggestedTutorialId) void startTutorial(json.suggestedTutorialId);
      }
    } finally {
      setAskBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <>
      {activeTutorial ? (
        <InteractiveTour
          tutorial={activeTutorial}
          stepIndex={stepIndex}
          onStepIndexChange={setStepIndex}
          onClose={() => setActiveTutorialId(null)}
          onComplete={async () => {
            if (!activeTutorialId || !activeTutorial) return;
            const steps = activeTutorial.steps.map((s) => s.id);
            await patchProgress(activeTutorialId, {
              status: "completed",
              completedSteps: steps,
              lastStep: steps[steps.length - 1] ?? null,
            });
            setActiveTutorialId(null);
          }}
          onSkip={async () => {
            if (!activeTutorialId) return;
            await patchProgress(activeTutorialId, { status: "skipped", lastStep: null });
            setActiveTutorialId(null);
          }}
        />
      ) : null}

      <div className="space-y-3 text-sm">
        {sectionHint ? (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{sectionHint.title}:</span> {sectionHint.prompt}
          </p>
        ) : null}
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Naučit se funkci</p>
        <ul className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
          {tutorials.map((t) => {
            const p = progress.find((x) => x.tutorialId === t.id);
            const done = p?.status === "completed" || p?.status === "skipped";
            const inProgress = p?.status === "in_progress";
            return (
              <li key={t.id} className="flex items-start justify-between gap-2 border rounded-lg p-2">
                <div className="min-w-0">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.summary}</p>
                  {inProgress ? (
                    <p className="text-xs text-primary mt-1">Rozpracovaný návod — pokračovat</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={done ? "outline" : "default"}
                  disabled={!!activeTutorialId}
                  onClick={() => void startTutorial(t.id)}
                >
                  {inProgress ? "Pokračovat" : done ? "Znovu" : "Spustit"}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zeptat se AI učitele</p>
          <Input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Např. jak vystavit zálohovou fakturu…"
            onKeyDown={(e) => e.key === "Enter" && void submitAsk()}
          />
          <Button type="button" size="sm" className="w-full" disabled={askBusy} onClick={() => void submitAsk()}>
            {askBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Odeslat dotaz"}
          </Button>
          {askReply ? <p className="text-sm text-muted-foreground">{askReply}</p> : null}
        </div>
      </div>
    </>
  );
}
