"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, MessageCircle, Sparkles } from "lucide-react";
import { InteractiveTour } from "@/components/ai-tutor/interactive-tour";
import { getTutorialById } from "@/lib/ai-tutor/tutorial-registry";
import { aiTutorSectionHint } from "@/lib/ai-tutor/section-hints";
import type { AiTutorialProgressDoc } from "@/lib/ai-tutor/types";
import { cn } from "@/lib/utils";

const WELCOME_KEY = "rajmondata_ai_tutor_welcome_v1";

type Props = {
  enabled: boolean;
};

export function AiTutorShell({ enabled }: Props) {
  const { user } = useUser();
  const { companyId } = useCompany();
  const pathname = usePathname() ?? "";
  const [panelOpen, setPanelOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
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

  useEffect(() => {
    if (!enabled || !user) return;
    try {
      if (localStorage.getItem(WELCOME_KEY) === "1") return;
      setWelcomeOpen(true);
    } catch {
      setWelcomeOpen(true);
    }
  }, [enabled, user]);

  const dismissWelcome = (startGuide: boolean) => {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      /* ignore */
    }
    setWelcomeOpen(false);
    if (startGuide && tutorials[0]) {
      void startTutorial(tutorials[0].id);
    }
  };

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

  const startTutorial = async (id: string) => {
    setActiveTutorialId(id);
    setStepIndex(0);
    await patchProgress(id, { status: "in_progress", completedSteps: [], lastStep: null });
  };

  useEffect(() => {
    const fn = (e: Event) => {
      const id = (e as CustomEvent<{ tutorialId: string }>).detail?.tutorialId;
      if (id) void startTutorial(id);
    };
    window.addEventListener("rajmondata:start-ai-tutorial", fn);
    return () => window.removeEventListener("rajmondata:start-ai-tutorial", fn);
  });

  const completeTutorial = async () => {
    if (!activeTutorialId || !activeTutorial) return;
    const steps = activeTutorial.steps.map((s) => s.id);
    await patchProgress(activeTutorialId, {
      status: "completed",
      completedSteps: steps,
      lastStep: steps[steps.length - 1] ?? null,
    });
    setActiveTutorialId(null);
  };

  const skipTutorial = async () => {
    if (!activeTutorialId) return;
    await patchProgress(activeTutorialId, { status: "skipped", lastStep: null });
    setActiveTutorialId(null);
  };

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
        if (json.suggestedTutorialId) {
          setPanelOpen(true);
        }
      }
    } finally {
      setAskBusy(false);
    }
  };

  if (!enabled || !user || !companyId) return null;

  return (
    <>
      <Dialog open={welcomeOpen} onOpenChange={setWelcomeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Vítejte v RAJMONDATA
            </DialogTitle>
            <DialogDescription className="text-base leading-relaxed pt-2">
              Jsem vaše AI průvodkyně. Pomohu vám nastavit firmu a ukážu, jak systém používat. Začneme první
              zakázkou, zaměstnancem nebo připojením e-mailu?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
            <Button type="button" onClick={() => dismissWelcome(true)}>
              Zahájit průvodce
            </Button>
            <Button type="button" variant="outline" onClick={() => void startTutorial("first-job")}>
              Naučit se zakázky
            </Button>
            <Button type="button" variant="ghost" onClick={() => dismissWelcome(false)}>
              Přeskočit — vrátím se později
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeTutorial ? (
        <InteractiveTour
          tutorial={activeTutorial}
          stepIndex={stepIndex}
          onStepIndexChange={setStepIndex}
          onClose={() => setActiveTutorialId(null)}
          onComplete={() => void completeTutorial()}
          onSkip={() => void skipTutorial()}
        />
      ) : null}

      {panelOpen ? (
        <div className="fixed bottom-20 right-4 z-[65] w-[min(92vw,380px)] rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> AI učitel
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanelOpen(false)}>
              Zavřít
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-4 space-y-3 text-sm">
            {sectionHint ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{sectionHint.title}:</span> {sectionHint.prompt}
              </p>
            ) : null}
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <ul className="space-y-2">
              {tutorials.map((t) => {
                const p = progress.find((x) => x.tutorialId === t.id);
                const done = p?.status === "completed" || p?.status === "skipped";
                return (
                  <li key={t.id} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.summary}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={done ? "outline" : "default"}
                      disabled={!!activeTutorialId}
                      onClick={() => void startTutorial(t.id)}
                    >
                      {done ? "Znovu" : "Spustit"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-2 pt-2 border-t">
              <Input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Vlastní dotaz…"
                onKeyDown={(e) => e.key === "Enter" && void submitAsk()}
              />
              <Button type="button" size="sm" className="w-full" disabled={askBusy} onClick={() => void submitAsk()}>
                {askBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Zeptat se"}
              </Button>
              {askReply ? <p className="text-sm text-muted-foreground">{askReply}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={cn(
          "fixed bottom-4 right-4 z-[64] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg touch-manipulation",
          "hover:opacity-90 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
        )}
        aria-label="AI učitel"
        onClick={() => setPanelOpen((o) => !o)}
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    </>
  );
}

/** Pro dashboard — spuštění průvodce z jiné komponenty. */
export function dispatchStartAiTutorial(tutorialId: string) {
  window.dispatchEvent(new CustomEvent("rajmondata:start-ai-tutorial", { detail: { tutorialId } }));
}
