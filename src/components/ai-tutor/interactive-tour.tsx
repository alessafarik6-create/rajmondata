"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { AiTutorialDef, AiTutorialStepDef } from "@/lib/ai-tutor/types";
import { cn } from "@/lib/utils";

type Props = {
  tutorial: AiTutorialDef;
  stepIndex: number;
  onStepIndexChange: (index: number) => void;
  onClose: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

function resolveTarget(step: AiTutorialStepDef): string | null {
  if (step.tourTarget) return `[data-tour-id="${step.tourTarget}"]`;
  if (step.navTarget) return `[data-onboarding-nav="${step.navTarget}"]`;
  return null;
}

function stepMatchesRoute(step: AiTutorialStepDef, pathname: string): boolean {
  return pathname.startsWith(step.routePrefix);
}

export function InteractiveTour({
  tutorial,
  stepIndex,
  onStepIndexChange,
  onClose,
  onComplete,
  onSkip,
}: Props) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const step = tutorial.steps[stepIndex];
  const [rect, setRect] = useState<DOMRect | null>(null);

  const needsNav = step && !stepMatchesRoute(step, pathname);

  useEffect(() => {
    if (!step || needsNav) {
      setRect(null);
      return;
    }
    const measure = () => {
      const sel = resolveTarget(step);
      const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    };
    const t = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, pathname, needsNav]);

  const goNext = useCallback(() => {
    if (stepIndex >= tutorial.steps.length - 1) {
      onComplete();
      return;
    }
    const nextIdx = stepIndex + 1;
    const nextStep = tutorial.steps[nextIdx];
    onStepIndexChange(nextIdx);
    if (nextStep && !stepMatchesRoute(nextStep, pathname)) {
      router.push(nextStep.routePrefix === "/portal" ? "/portal/dashboard" : nextStep.routePrefix);
    }
  }, [stepIndex, tutorial, onComplete, onStepIndexChange, pathname, router]);

  const goPrev = useCallback(() => {
    if (stepIndex <= 0) return;
    const prevIdx = stepIndex - 1;
    const prevStep = tutorial.steps[prevIdx];
    onStepIndexChange(prevIdx);
    if (prevStep && !stepMatchesRoute(prevStep, pathname)) {
      router.push(prevStep.routePrefix === "/portal" ? "/portal/dashboard" : prevStep.routePrefix);
    }
  }, [stepIndex, tutorial, onStepIndexChange, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  const tooltipStyle = useMemo(() => {
    if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    const top = Math.min(window.innerHeight - 200, rect.bottom + 12);
    const left = Math.min(window.innerWidth - 320, Math.max(12, rect.left));
    return { top, left, maxWidth: "min(92vw, 360px)" };
  }, [rect]);

  if (!step) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/50" aria-hidden />
      {rect ? (
        <div
          className="pointer-events-none fixed z-[71] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      ) : null}
      <div
        className="fixed z-[72] rounded-xl border border-border bg-card p-4 shadow-2xl"
        style={tooltipStyle}
        role="dialog"
        aria-labelledby="ai-tour-title"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-primary">
              Průvodce · {stepIndex + 1}/{tutorial.steps.length}
            </p>
            <h3 id="ai-tour-title" className="text-base font-semibold">
              {step.title}
            </h3>
          </div>
          <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Zavřít" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
        {needsNav ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Nejdřív přejděte do správné sekce — použijte Další nebo menu.
          </p>
        ) : null}
        {step.requiresUserAction ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Proveďte akci v aplikaci, potom pokračujte tlačítkem Další.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={stepIndex <= 0} onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onSkip}>
            Přeskočit
          </Button>
          <Button type="button" size="sm" className={cn("ml-auto")} onClick={goNext}>
            {stepIndex >= tutorial.steps.length - 1 ? "Dokončit" : "Další"}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}
