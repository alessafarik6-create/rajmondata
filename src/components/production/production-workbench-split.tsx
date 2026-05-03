"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function useIsLg() {
  const [lg, setLg] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const fn = () => setLg(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return lg;
}

type ProductionWorkbenchSplitProps = {
  /** Klíč do localStorage pro šířku panelů (desktop) */
  storageKeyPrefix: string;
  className?: string;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
};

/**
 * Výrobní dílna: nahoře PDF/výkres vlevo a výběr materiálu vpravo (bez překryvů),
 * dole „Materiál pro zakázku“. Na desktopu jen horizontální rozdělovač šířky.
 * Na mobilu sloupce: PDF → sklad → spodek.
 */
export function ProductionWorkbenchSplit({
  storageKeyPrefix,
  className,
  leftPanel,
  rightPanel,
  bottomPanel,
}: ProductionWorkbenchSplitProps) {
  const [splitPct, setSplitPct] = useState(46);
  const dragW = useRef<{ x: number; pct: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isLg = useIsLg();

  useEffect(() => {
    try {
      const w = localStorage.getItem(`${storageKeyPrefix}-w`);
      if (w) {
        const n = Number(w);
        if (Number.isFinite(n)) setSplitPct(Math.min(72, Math.max(28, n)));
      }
    } catch {
      /* ignore */
    }
  }, [storageKeyPrefix]);

  useEffect(() => {
    try {
      localStorage.setItem(`${storageKeyPrefix}-w`, String(splitPct));
    } catch {
      /* ignore */
    }
  }, [storageKeyPrefix, splitPct]);

  const onMoveW = useCallback((e: PointerEvent) => {
    const st = dragW.current;
    const row = rowRef.current;
    if (!st || !row) return;
    const rect = row.getBoundingClientRect();
    const dx = e.clientX - st.x;
    const deltaPct = (dx / rect.width) * 100;
    setSplitPct(Math.min(72, Math.max(28, st.pct + deltaPct)));
  }, []);

  const endW = useCallback(() => {
    dragW.current = null;
    window.removeEventListener("pointermove", onMoveW);
    window.removeEventListener("pointerup", endW);
    window.removeEventListener("pointercancel", endW);
  }, [onMoveW]);

  const startW = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragW.current = { x: e.clientX, pct: splitPct };
      window.addEventListener("pointermove", onMoveW);
      window.addEventListener("pointerup", endW);
      window.addEventListener("pointercancel", endW);
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* */
      }
    },
    [endW, onMoveW, splitPct]
  );

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col gap-0 overflow-hidden lg:min-h-[min(72vh,640px)] lg:max-h-[min(78vh,820px)]",
        className
      )}
    >
      <div
        ref={rowRef}
        className="flex min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden lg:flex-row lg:items-stretch"
      >
        {/* Levý panel — PDF / výkres, vlastní scroll uvnitř obsahu */}
        <div
          className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:shrink-0"
          style={isLg ? { width: `${splitPct}%`, minWidth: 0 } : { minHeight: "min(42vh, 420px)", maxHeight: "48vh" }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{leftPanel}</div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Změnit šířku panelů výkres a sklad"
          className="hidden w-2 shrink-0 cursor-col-resize flex-col items-center justify-center border-y border-slate-200 bg-slate-100 hover:bg-slate-200 lg:flex"
          onPointerDown={startW}
        />

        {/* Pravý panel — jeden sloupec, scroll jen uvnitř (ne celá stránka) */}
        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/90 shadow-sm",
            "min-h-[min(52vh,520px)] lg:min-h-0 lg:max-h-none"
          )}
        >
          {rightPanel}
        </div>
      </div>

      <div className="mt-2 w-full shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm sm:mt-3">
        {bottomPanel}
      </div>
    </div>
  );
}
