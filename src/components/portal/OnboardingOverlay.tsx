"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useFirestore, useUser, useDoc, useMemoFirebase, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import {
  ONBOARDING_STEPS,
  onboardingNavIdFromRoute,
  onboardingStepToNavId,
  type OnboardingStepDef,
} from "@/lib/onboarding-steps";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { cn } from "@/lib/utils";

const SESSION_COLLAPSE_KEY = "onboarding_overlay_collapsed";
const ONBOARDING_STEPS_COLLECTION = "onboardingSteps";

type OnboardingOverlayProps = {
  /** Hlavní firemní portál (ne klientský / čistě zaměstnanecký režim). */
  enabled: boolean;
};

type OnboardingStepDoc = {
  title?: string;
  description?: string;
  route?: string;
  targetSelector?: string | null;
  order?: number;
  enabled?: boolean;
};

function normalizeStepsFromFirestore(
  rows: Array<{ id: string } & Record<string, unknown>>
): OnboardingStepDef[] {
  const list: OnboardingStepDef[] = rows
    .map((r) => {
      const title = String(r.title || "").trim();
      const description = String(r.description || "").trim();
      const route = String(r.route || "").trim();
      const enabled = r.enabled !== false;
      const order = typeof r.order === "number" && Number.isFinite(r.order) ? r.order : 9999;
      const targetSelector =
        typeof r.targetSelector === "string" && r.targetSelector.trim()
          ? r.targetSelector.trim()
          : null;
      if (!title || !description || !route) return null;
      return {
        id: String(r.id || "").trim() || `${order}:${title}`,
        title,
        description,
        route,
        enabled,
        order,
        targetSelector,
      } satisfies OnboardingStepDef;
    })
    .filter(Boolean) as OnboardingStepDef[];

  return list
    .filter((x) => x.enabled !== false)
    .sort((a, b) => (Number(a.order ?? 0) || 0) - (Number(b.order ?? 0) || 0));
}

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
  const [stepsRemote, setStepsRemote] = useState<OnboardingStepDef[] | null>(null);
  const [stepsLoading, setStepsLoading] = useState(false);

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

  const steps = useMemo(() => {
    const remote = stepsRemote;
    if (remote && remote.length > 0) return remote;
    return [...ONBOARDING_STEPS];
  }, [stepsRemote]);

  const stepIndex = useMemo(() => {
    const raw = (company as { onboardingStep?: unknown })?.onboardingStep;
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(n, Math.max(0, steps.length - 1)));
  }, [company, steps.length]);

  const step = steps[stepIndex] ?? steps[0];
  const navTarget = step?.id ? onboardingStepToNavId(step.id) : onboardingNavIdFromRoute(step?.route);

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
      const selector =
        typeof step?.targetSelector === "string" && step.targetSelector.trim().length > 0
          ? step.targetSelector.trim()
          : `[data-onboarding-nav="${navTarget}"]`;
      let el = document.querySelector(selector) as HTMLElement | null;
      if (!el && selector !== `[data-onboarding-nav="${navTarget}"]`) {
        el = document.querySelector(`[data-onboarding-nav="${navTarget}"]`) as HTMLElement | null;
      }
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
  }, [showFlow, collapsed, navTarget, pathname, step?.targetSelector]);

  useEffect(() => {
    if (!showFlow || !firestore) return;
    setStepsLoading(true);
    const qRef = query(collection(firestore, ONBOARDING_STEPS_COLLECTION));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as OnboardingStepDoc) })) as Array<
          { id: string } & Record<string, unknown>
        >;
        const normalized = normalizeStepsFromFirestore(rows);
        setStepsRemote(normalized.length > 0 ? normalized : null);
        setStepsLoading(false);
      },
      (err) => {
        console.warn("[OnboardingOverlay] onboardingSteps snapshot", err);
        setStepsRemote(null);
        setStepsLoading(false);
      }
    );
    return () => unsub();
  }, [showFlow, firestore]);

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
    await persist({ onboardingCompleted: true, onboardingStep: steps.length });
  };

  const skip = async () => {
    await finish();
  };

  const next = async () => {
    if (!step) return;
    if (stepIndex >= steps.length - 1) {
      await finish();
      router.push(step.route);
      return;
    }
    await persist({ onboardingStep: stepIndex + 1 });
    router.push(step.route);
  };

  const prev = async () => {
    if (!step) return;
    if (stepIndex <= 0) {
      router.push(step.route);
      return;
    }
    await persist({ onboardingStep: stepIndex - 1 });
    const back = steps[Math.max(0, stepIndex - 1)];
    router.push(back?.route || step.route);
  };

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/45" aria-hidden />
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

      <div className="fixed inset-0 z-[58] flex items-end justify-center p-3 sm:items-center sm:p-6">
        <div className="pointer-events-auto w-[min(95vw,900px)] rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold tracking-wide text-primary">
                <Sparkles className="h-4 w-4" />
                Průvodce portálem
              </p>
              <h2 className="mt-1 text-2xl font-semibold leading-snug text-foreground sm:text-3xl">
                {step?.title || "Začínáme"}
              </h2>
            </div>
            <button
              type="button"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Skrýt průvodce"
              onClick={() => setCollapsedStored(true)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-12 sm:gap-6 sm:px-6 sm:py-6">
            <div className="sm:col-span-5">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-sm font-semibold text-foreground">Kroky</p>
                <div className="mt-3 space-y-2">
                  {steps.map((s, i) => (
                    <div
                      key={`${s.id}-${i}`}
                      className={cn(
                        "rounded-lg border p-3 transition-colors",
                        i === stepIndex
                          ? "border-primary/50 bg-background shadow-sm"
                          : "border-border bg-background/60"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-sm font-semibold", i === stepIndex ? "text-foreground" : "text-foreground/85")}>
                          {i + 1}. {s.title}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            i === stepIndex ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}
                        >
                          {i === stepIndex ? "aktuální" : i < stepIndex ? "hotovo" : "čeká"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                    </div>
                  ))}
                  {stepsLoading ? (
                    <p className="text-xs text-muted-foreground">Načítám kroky průvodce…</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="sm:col-span-7">
              <div className="rounded-xl border border-border bg-background p-4 sm:p-5">
                <p className="text-base leading-relaxed text-foreground">{step?.description || ""}</p>
                {step?.route ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Otevřu vás na: <span className="font-mono">{step.route}</span>
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={stepIndex <= 0}
                    onClick={() => void prev()}
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Zpět
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void skip()}>
                    Přeskočit
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 text-muted-foreground"
                    onClick={() => void finish()}
                  >
                    Dokončit
                  </Button>
                  <Button type="button" className="min-h-11" onClick={() => void next()}>
                    {stepIndex >= steps.length - 1 ? "Dokončit" : "Další"}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Postup se ukládá do firmy — po obnovení stránky pokračujete stejným krokem.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
