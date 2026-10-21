"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PublicMarketingHeader } from "@/components/marketing/public-marketing-header";
import { ProductDemoPortalShell } from "@/components/ai-tutor/product-demo-portal-shell";
import { ProductTourGuidePanel } from "@/components/ai-tutor/product-tour-guide-panel";
import { useProductTourDemo } from "@/contexts/product-tour-demo-context";
import { buildDetailedDemoSteps, detailedChapterLabels } from "@/lib/ai-tutor/product-demo-detailed";
import { buildCompleteDemoSteps } from "@/lib/product-tour/complete-tour-script";
import {
  COMPANY_TYPE_LABELS,
  type CompanyType,
} from "@/lib/product-tour/company-type";
import {
  quickDemoSteps,
  type ProductDemoInterest,
  type ProductDemoMode,
  type ProductDemoStep,
} from "@/lib/ai-tutor/product-demo-script";
import { useProductTourNarration } from "@/hooks/use-product-tour-narration";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";

const VISITOR_KEY = "rajmondata_vid_v1";
const MODE_KEY = "rajmondata_demo_mode";
const SESSION_KEY = "rajmondata_demo_session_v2";
const COMPANY_KEY = "rajmondata_demo_company_type";

function visitorId(): string {
  try {
    let id = sessionStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

function trackDemo(event: string, extra?: Record<string, string>) {
  const vid = visitorId();
  if (vid === "anonymous") return;
  void fetch("/api/public/product-tour/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, visitorId: vid, path: "/prohlidka", ...extra }),
    keepalive: true,
  }).catch(() => {});
}

export function ProductDemoPage() {
  const [mode, setMode] = useState<ProductDemoMode | null>(null);
  const [interest] = useState<ProductDemoInterest>("full");
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [companyType, setCompanyType] = useState<CompanyType | null>(null);
  const [needsSoundGesture, setNeedsSoundGesture] = useState(false);
  const [offerContinue, setOfferContinue] = useState(false);

  const { demo, tourPausedByUser, setTourPausedByUser, applyDemoActions } = useProductTourDemo();
  const narration = useProductTourNarration();
  const skipNextPlayRef = useRef(false);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused || tourPausedByUser;
  startedRef.current = started;

  const steps = useMemo((): ProductDemoStep[] => {
    if (mode === "detailed") return buildDetailedDemoSteps();
    if (mode === "complete") return buildCompleteDemoSteps();
    if (mode === "quick") return quickDemoSteps(interest);
    return [];
  }, [mode, interest]);

  const step = steps[stepIndex];
  const chapters = useMemo(() => (mode === "detailed" ? detailedChapterLabels() : []), [mode]);

  const tourPaused = paused || tourPausedByUser;

  const advanceStep = useCallback(() => {
    if (pausedRef.current || tourPausedByUser) return;
    setStepIndex((i) => {
      if (i >= steps.length - 1) {
        setCompleted(true);
        trackDemo("demo_completed", { mode: mode ?? "" });
        return i;
      }
      const next = i + 1;
      trackDemo("demo_step_viewed", { stepId: steps[next]?.id ?? "", mode: mode ?? "" });
      return next;
    });
  }, [steps, mode, tourPausedByUser]);

  useEffect(() => {
    if (!mode) return;
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ mode, stepIndex, started, companyType })
      );
    } catch {
      /* ignore */
    }
  }, [mode, stepIndex, started, companyType]);

  const playCurrentStep = useCallback(
    (index: number) => {
      const s = steps[index];
      if (!s || !startedRef.current) return;
      void narration.playStep({
        stepId: s.id,
        narration: s.narration,
        muted,
        durationSec: s.durationSec,
        volume: narration.volume,
        onEnded: () => {
          if (!pausedRef.current && startedRef.current) advanceStep();
        },
        onDiagnostic: (code, engine) => {
          trackDemo("demo_voice_error", {
            mode: mode ?? "",
            stepId: s.id,
            errorCode: code,
            engine,
          });
          if (process.env.NODE_ENV === "development") {
            console.debug("[product-tour/narration]", { stepId: s.id, code, engine });
          }
        },
      });
    },
    [steps, muted, narration, advanceStep, mode]
  );

  useEffect(() => {
    trackDemo("demo_opened");
    try {
      const saved = sessionStorage.getItem(MODE_KEY) as ProductDemoMode | null;
      if (saved === "quick" || saved === "detailed" || saved === "complete") setMode(saved);
      const ct = sessionStorage.getItem(COMPANY_KEY) as CompanyType | null;
      if (ct && COMPANY_TYPE_LABELS[ct]) setCompanyType(ct);
      const sess = sessionStorage.getItem(SESSION_KEY);
      if (sess) {
        const p = JSON.parse(sess) as { stepIndex?: number; started?: boolean };
        if (typeof p.stepIndex === "number") setStepIndex(p.stepIndex);
        if (p.started) setStarted(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!started || !step) return;
    if (skipNextPlayRef.current) {
      skipNextPlayRef.current = false;
      return;
    }
    if (tourPaused) {
      narration.pause();
      return;
    }
    playCurrentStep(stepIndex);
    const preload = steps.slice(stepIndex + 1, stepIndex + 4).map((s) => s.id);
    void narration.preloadSteps(preload);
    return () => narration.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, stepIndex, step?.id, muted, tourPaused]);

  useEffect(() => {
    if (!mode || !steps.length) return;
    void narration.preloadSteps(steps.slice(0, 3).map((s) => s.id));
  }, [mode, steps, narration]);

  const pickMode = (m: ProductDemoMode) => {
    setMode(m);
    setStepIndex(0);
    setStarted(false);
    setCompleted(false);
    setPaused(false);
    narration.stop();
    try {
      sessionStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
    trackDemo(
      m === "quick"
        ? "demo_quick_started"
        : m === "complete"
          ? "demo_complete_started"
          : "demo_detailed_started"
    );
  };

  const beginWithVoice = async () => {
    skipNextPlayRef.current = true;
    const unlocked = await narration.unlockAudio();
    setNeedsSoundGesture(!unlocked && narration.getDiagnostics().needsGesture);
    setStarted(true);
    setCompleted(false);
    setStepIndex(0);
    setPaused(false);
    setMuted(false);
    trackDemo("demo_started", { mode: mode ?? "" });
    trackDemo("demo_voice_on", { mode: mode ?? "" });
    trackDemo("demo_step_viewed", { stepId: steps[0]?.id ?? "intro", mode: mode ?? "" });
    playCurrentStep(0);
  };

  const continueWithSound = async () => {
    await narration.unlockAudio();
    setNeedsSoundGesture(false);
    setMuted(false);
    playCurrentStep(stepIndex);
  };

  const exitTour = () => {
    narration.stop();
    setStarted(false);
    setPaused(false);
    setStepIndex(0);
  };

  const prevStep = () => {
    narration.stop();
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const nextStep = () => {
    narration.stop();
    if (stepIndex >= steps.length - 1) {
      setCompleted(true);
      trackDemo("demo_completed", { mode: mode ?? "" });
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const skipStep = () => {
    narration.stop();
    trackDemo("demo_chapter_skipped", { stepId: step?.id ?? "", mode: mode ?? "" });
    trackDemo("demo_skipped", { stepId: step?.id ?? "" });
    nextStep();
  };

  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      if (next) narration.pause();
      else narration.resume();
      return next;
    });
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      trackDemo(next ? "demo_voice_off" : "demo_voice_on", { mode: mode ?? "" });
      if (next) narration.stop();
      else playCurrentStep(stepIndex);
      return next;
    });
  };

  const repeatVoice = () => {
    if (!step) return;
    narration.repeatCurrent({
      stepId: step.id,
      narration: step.narration,
      muted,
      durationSec: step.durationSec,
      volume: narration.volume,
      onEnded: () => {
        if (!pausedRef.current && startedRef.current) advanceStep();
      },
    });
  };

  const jumpChapter = (chapterId: string) => {
    const idx = steps.findIndex((s) => s.chapterId === chapterId);
    if (idx >= 0) {
      narration.stop();
      setStepIndex(idx);
      trackDemo("demo_step_viewed", { stepId: steps[idx]?.id ?? "", mode: mode ?? "" });
    }
  };

  const registerHref = `/register?demoMode=${encodeURIComponent(mode ?? "quick")}${
    companyType ? `&companyType=${encodeURIComponent(companyType)}` : ""
  }`;

  const handleInterrupt = useCallback(() => {
    narration.stop();
    setPaused(true);
    setTourPausedByUser(true);
  }, [narration, setTourPausedByUser]);

  const handleAssistantReply = useCallback(
    (result: {
      answer: string;
      demoActions: import("@/lib/product-tour/demo-actions").DemoAction[];
      offerContinueTour: boolean;
    }) => {
      trackDemo("demo_chat_message", { mode: mode ?? "" });
      applyDemoActions(result.demoActions);
      setOfferContinue(result.offerContinueTour);
      if (!muted && typeof window !== "undefined" && window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(result.answer.slice(0, 400));
        u.lang = "cs-CZ";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    },
    [applyDemoActions, mode, muted]
  );

  const effectiveView = tourPausedByUser ? demo.view : step?.demoView;
  const effectiveHighlight = tourPausedByUser ? demo.highlight : step?.highlight;
  const demoStepForShell: ProductDemoStep | undefined = step
    ? { ...step, demoView: effectiveView ?? step.demoView, highlight: effectiveHighlight }
    : undefined;

  const statusLine =
    narration.playState === "loading"
      ? "Načítám hlas…"
      : narration.playState === "playing"
        ? narration.engine === "mp3"
          ? "Přehrávám namluvený výklad…"
          : narration.engine === "speech"
            ? "Mluvím (hlas prohlížeče)…"
            : "Titulky — časovač"
        : paused
          ? "Pauza"
          : "";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <PublicMarketingHeader />
      <div className="mx-auto max-w-6xl px-4 py-8 flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-8">
        <div className="space-y-4">
          {!mode ? (
            <Card className="bg-slate-900/80 border-slate-700 text-slate-100">
              <CardContent className="pt-6 space-y-4">
                <h1 className="text-2xl font-bold">AI prohlídka RAJMONDATA</h1>
                <p className="text-slate-300">Vyberte režim — oba jsou s českým hlasovým výkladem a ukázkovými daty.</p>
                <Button className="w-full justify-start bg-orange-500 hover:bg-orange-600" onClick={() => pickMode("quick")}>
                  ▶ Rychlá prohlídka — cca 2 minuty
                </Button>
                <Button variant="outline" className="w-full justify-start border-slate-600" onClick={() => pickMode("detailed")}>
                  Podrobná prohlídka — moduly portálu
                </Button>
                <Button variant="outline" className="w-full justify-start border-slate-600" onClick={() => pickMode("complete")}>
                  Kompletní prohlídka — proces 5–10 min
                </Button>
                <Button asChild variant="ghost" className="w-full">
                  <Link href="/register">Vyzkoušet 30 dní zdarma</Link>
                </Button>
              </CardContent>
            </Card>
          ) : completed ? (
            <Card className="bg-slate-900/80 border-primary/40">
              <CardContent className="pt-6 space-y-4">
                <h2 className="text-xl font-semibold">Viděli jste, jak RAJMONDATA pomáhá řídit firmu</h2>
                <p className="text-slate-300">
                  Teď si jej můžete vyzkoušet na vlastní firmě — AI průvodkyně vás provede nastavením.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild className="bg-orange-500 hover:bg-orange-600" onClick={() => trackDemo("demo_cta_clicked")}>
                    <Link href={registerHref}>Registrovat firmu zdarma</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/#pricing">Zobrazit ceník</Link>
                  </Button>
                  <Button variant="ghost" onClick={() => pickMode("detailed")}>
                    Prohlédnout další funkce
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {!companyType ? (
                <Card className="bg-slate-900/80 border-slate-700">
                  <CardContent className="pt-4 space-y-2">
                    <p className="text-sm text-slate-200">Jaký typ firmy provozujete?</p>
                    {(Object.keys(COMPANY_TYPE_LABELS) as CompanyType[]).map((id) => (
                      <Button
                        key={id}
                        variant="outline"
                        className="w-full justify-start border-slate-600"
                        onClick={() => {
                          setCompanyType(id);
                          try {
                            sessionStorage.setItem(COMPANY_KEY, id);
                          } catch {
                            /* ignore */
                          }
                          trackDemo("demo_company_type", { interest: id });
                        }}
                      >
                        {COMPANY_TYPE_LABELS[id]}
                      </Button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => setCompanyType("other")}>
                      Přeskočit
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
              <p className="text-xs text-slate-400">
                Režim:{" "}
                {mode === "quick" ? "Rychlá (~2 min)" : mode === "complete" ? "Kompletní" : "Podrobná"}
                {companyType ? ` · ${COMPANY_TYPE_LABELS[companyType]}` : ""} ·{" "}
                <button type="button" className="underline" onClick={() => setMode(null)}>
                  Změnit
                </button>
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                {!started ? (
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-base px-5 py-6 h-auto"
                    disabled={!companyType}
                    onClick={() => void beginWithVoice()}
                  >
                    ▶ Spustit prohlídku s českým hlasovým průvodcem
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={togglePause} aria-label={paused ? "Pokračovat" : "Pauza"}>
                      {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" onClick={repeatVoice} aria-label="Zopakovat hlas">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" onClick={prevStep} disabled={stepIndex <= 0} aria-label="Předchozí krok">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" onClick={nextStep} aria-label="Další krok">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" onClick={skipStep}>
                      <SkipForward className="h-4 w-4" /> Přeskočit
                    </Button>
                    <Button variant="ghost" onClick={exitTour} aria-label="Ukončit">
                      <Square className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={toggleMute} aria-label="Zvuk" disabled={!started}>
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
              </div>
              {needsSoundGesture ? (
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => void continueWithSound()}>
                  Pokračovat se zvukem
                </Button>
              ) : null}
              {offerContinue && tourPausedByUser ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTourPausedByUser(false);
                    setPaused(false);
                    setOfferContinue(false);
                    trackDemo("demo_resume_tour", { mode: mode ?? "" });
                    playCurrentStep(stepIndex);
                  }}
                >
                  Pokračovat v prohlídce
                </Button>
              ) : null}
              <ProductTourGuidePanel
                companyType={companyType}
                tourMode={mode}
                onBeforeSend={handleInterrupt}
                onUserSpeakingStart={handleInterrupt}
                onAssistantReply={handleAssistantReply}
                disabled={!companyType}
              />
              {!muted && started ? (
                <div className="flex items-center gap-3 max-w-xs">
                  <span className="text-xs text-slate-400 shrink-0">Hlasitost</span>
                  <Slider
                    value={[Math.round(narration.volume * 100)]}
                    max={100}
                    step={5}
                    onValueChange={(v) => narration.setVolume((v[0] ?? 100) / 100)}
                    className="flex-1"
                  />
                </div>
              ) : null}
              {narration.userMessage ? (
                <p
                  className={cnMessage(
                    narration.userMessage.tone === "warn" ? "text-amber-400" : "text-slate-300"
                  )}
                >
                  {narration.userMessage.text}
                </p>
              ) : null}
              {step ? (
                <Card className="bg-slate-900/80 border-primary/30">
                  <CardContent className="pt-6">
                    <p className="text-xs text-primary">{step.segment}</p>
                    <h2 className="text-xl font-semibold mt-1">{step.title}</h2>
                    <p className="mt-3 text-slate-200 leading-relaxed" role="status" aria-live="polite">
                      {step.narration}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-500">
                      Krok {stepIndex + 1} / {steps.length}
                      {statusLine ? ` · ${statusLine}` : ""}
                    </p>
                  </CardContent>
                </Card>
              ) : null}
              {mode === "detailed" && chapters.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {chapters.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] hover:border-orange-500"
                      onClick={() => jumpChapter(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild onClick={() => trackDemo("demo_cta_clicked")}>
                  <Link href={registerHref}>Vyzkoušet 30 dní zdarma</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/#pricing">Zobrazit ceník</Link>
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="order-first lg:order-none lg:col-span-1 min-h-[360px]">
          <ProductDemoPortalShell
            step={demoStepForShell ?? step}
            overrideView={tourPausedByUser ? demo.view : undefined}
            overrideHighlight={tourPausedByUser ? demo.highlight : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function cnMessage(extra: string) {
  return `text-xs ${extra}`;
}
