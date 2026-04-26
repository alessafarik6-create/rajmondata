"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useFirestore, useUser, useDoc, useMemoFirebase, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { X, Sparkles } from "lucide-react";
import { ONBOARDING_STEPS, onboardingStepToNavId } from "@/lib/onboarding-steps";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

const SESSION_COLLAPSE_KEY = "onboarding_overlay_collapsed";

type OnboardingOverlayProps = {
  /** Hlavní firemní portál (ne klientský / čistě zaměstnanecký režim). */
  enabled: boolean;
};

export function OnboardingOverlay({ enabled }: OnboardingOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();
  const firestore = useFirestore();
  const { user } = useUser();
  const { company, companyId } = useCompany();

  const userRef = useMemoFirebase(() => (user && firestore ? doc(firestore, "users", user.uid) : null), [
    firestore,
    user,
  ]);
  const { data: profile } = useDoc(userRef);
  const role = String(profile?.role || "");

  const isPortalEmployeeOnly =
    role === "employee" && !(Array.isArray(profile?.globalRoles) && profile.globalRoles.includes("super_admin"));
  const isPortalCustomerOnly = role === "customer";

  const [collapsed, setCollapsed] = useState(false);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    try {
      setCollapsed(sessionStorage.getItem(SESSION_COLLAPSE_KEY) === "1");
    } catch {
      setCollapsed(false);
    }
  }, []);

  const showFlow =
    enabled &&
    !isPortalEmployeeOnly &&
    !isPortalCustomerOnly &&
    company &&
    companyId &&
    firestore &&
    user &&
    (company as { onboardingCompleted?: boolean }).onboardingCompleted === false &&
    (role === "owner" || role === "admin");

  const stepIndex = useMemo(() => {
    const raw = (company as { onboardingStep?: unknown })?.onboardingStep;
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(n, ONBOARDING_STEPS.length - 1));
  }, [company]);

  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];
  const navTarget = onboardingStepToNavId(step.id);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!firestore || !companyId) return;
      await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    },
    [firestore, companyId]
  );

  const setCollapsedStored = (v: boolean) => {
    setCollapsed(v);
    try {
      if (v) sessionStorage.setItem(SESSION_COLLAPSE_KEY, "1");
      else sessionStorage.removeItem(SESSION_COLLAPSE_KEY);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!showFlow || collapsed) {
      setHighlightRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-onboarding-nav="${navTarget}"]`) as HTMLElement | null;
      if (!el) {
        setHighlightRect(null);
        return;
      }
      setHighlightRect(el.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [showFlow, collapsed, navTarget, pathname]);

  if (!showFlow) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur touch-manipulation"
        onClick={() => setCollapsedStored(false)}
      >
        <Sparkles className="h-4 w-4 text-primary" />
        Průvodce
      </button>
    );
  }

  const finish = async () => {
    await persist({ onboardingCompleted: true, onboardingStep: ONBOARDING_STEPS.length });
  };

  const skip = async () => {
    await finish();
  };

  const next = async () => {
    if (stepIndex >= ONBOARDING_STEPS.length - 1) {
      await finish();
      router.push(step.route);
      return;
    }
    await persist({ onboardingStep: stepIndex + 1 });
    router.push(step.route);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[55] bg-black/35 pointer-events-none"
        aria-hidden
      />
      {highlightRect ? (
        <div
          className="pointer-events-none fixed z-[56] rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_0_9999px_rgba(0,0,0,0.2)]"
          style={{
            top: highlightRect.top - 6,
            left: highlightRect.left - 6,
            width: highlightRect.width + 12,
            height: highlightRect.height + 12,
          }}
        />
      ) : null}

      <div className="fixed bottom-4 left-1/2 z-[58] w-[min(100%-1.5rem,420px)] -translate-x-1/2 pointer-events-auto">
        <div className="rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Průvodce platformou</p>
              <h2 className="mt-1 text-lg font-semibold leading-snug">{step.title}</h2>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Skrýt průvodce"
              onClick={() => setCollapsedStored(true)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void next()}>
              {stepIndex >= ONBOARDING_STEPS.length - 1 ? "Dokončit" : "Další"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void skip()}>
              Přeskočit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void finish()}
            >
              Dokončit
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Postup se ukládá do firmy — po obnovení stránky pokračujete stejným krokem.
          </p>
        </div>
      </div>
    </>
  );
}
