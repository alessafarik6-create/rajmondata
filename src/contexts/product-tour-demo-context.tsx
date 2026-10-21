"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { DemoHighlight, DemoView } from "@/lib/ai-tutor/product-demo-script";
import type { DemoAction } from "@/lib/product-tour/demo-actions";

type DemoState = {
  view: DemoView;
  highlight?: DemoHighlight;
  workflowId?: string;
  workflowStepIndex?: number;
  transitionKey: number;
};

type ProductTourDemoContextValue = {
  demo: DemoState;
  tourPausedByUser: boolean;
  setTourPausedByUser: (v: boolean) => void;
  applyDemoActions: (actions: DemoAction[]) => void;
  setDemoView: (view: DemoView, highlight?: DemoHighlight) => void;
};

const defaultState: DemoState = {
  view: "dashboard",
  transitionKey: 0,
};

const Ctx = createContext<ProductTourDemoContextValue | null>(null);

export function ProductTourDemoProvider({ children }: { children: React.ReactNode }) {
  const [demo, setDemo] = useState<DemoState>(defaultState);
  const [tourPausedByUser, setTourPausedByUser] = useState(false);

  const bump = useCallback((patch: Partial<DemoState>) => {
    setDemo((prev) => ({
      ...prev,
      ...patch,
      transitionKey: prev.transitionKey + 1,
    }));
  }, []);

  const setDemoView = useCallback(
    (view: DemoView, highlight?: DemoHighlight) => {
      bump({ view, highlight });
    },
    [bump]
  );

  const applyDemoActions = useCallback(
    (actions: DemoAction[]) => {
      for (const a of actions) {
        if (a.type === "navigateDemoModule") {
          bump({ view: a.module, highlight: undefined });
        } else if (a.type === "highlightDemoElement") {
          setDemo((prev) => ({ ...prev, highlight: a.highlight, transitionKey: prev.transitionKey + 1 }));
        } else if (a.type === "showDemoWorkflow") {
          bump({
            workflowId: a.workflowId,
            workflowStepIndex: a.stepIndex ?? 0,
            view: a.workflowId === "lead-to-invoice" ? "customers" : "jobs-form",
          });
        } else if (a.type === "pauseTour") {
          setTourPausedByUser(true);
        } else if (a.type === "resumeTour" || a.type === "continueTour") {
          setTourPausedByUser(false);
        }
      }
    },
    [bump]
  );

  const value = useMemo(
    () => ({
      demo,
      tourPausedByUser,
      setTourPausedByUser,
      applyDemoActions,
      setDemoView,
    }),
    [demo, tourPausedByUser, applyDemoActions, setDemoView]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProductTourDemo() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProductTourDemo mimo ProductTourDemoProvider");
  return ctx;
}
