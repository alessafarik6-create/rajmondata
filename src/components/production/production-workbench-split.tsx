"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";

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
  /** Klíč do localStorage pro šířku a výšku náhledu */
  storageKeyPrefix: string;
  className?: string;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
};

/**
 * Notebook layout: vlevo náhled (výška tahem), vpravo obsah, dole plná šířka.
 * Desktop: šířka vlevo/vpravo tahem. Mobil: sloupce pod sebou.
 */
export function ProductionWorkbenchSplit({
  storageKeyPrefix,
  className,
  leftPanel,
  rightPanel,
  bottomPanel,
}: ProductionWorkbenchSplitProps) {
  const [splitPct, setSplitPct] = useState(46);
  const [previewH, setPreviewH] = useState(340);
  const dragW = useRef<{ x: number; pct: number; width: number } | null>(null);
  const dragH = useRef<{ y: number; h: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isLg = useIsLg();

  useEffect(() => {
    try {
      const w = localStorage.getItem(`${storageKeyPrefix}-w`);
      const h = localStorage.getItem(`${storageKeyPrefix}-h`);
      if (w) {
        const n = Number(w);
        if (Number.isFinite(n)) setSplitPct(Math.min(72, Math.max(28, n)));
      }
      if (h) {
        const n = Number(h);
        if (Number.isFinite(n)) setPreviewH(Math.min(720, Math.max(180, n)));
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

  useEffect(() => {
    try {
      localStorage.setItem(`${storageKeyPrefix}-h`, String(previewH));
    } catch {
      /* ignore */
    }
  }, [storageKeyPrefix, previewH]);

  const onMoveW = useCallback(
    (e: PointerEvent) => {
      const st = dragW.current;
      const row = rowRef.current;
      if (!st || !row) return;
      const rect = row.getBoundingClientRect();
      const dx = e.clientX - st.x;
      const deltaPct = (dx / rect.width) * 100;
      setSplitPct(Math.min(72, Math.max(28, st.pct + deltaPct)));
    },
    []
  );

  const endW = useCallback(() => {
    dragW.current = null;
    window.removeEventListener("pointermove", onMoveW);
    window.removeEventListener("pointerup", endW);
    window.removeEventListener("pointercancel", endW);
  }, [onMoveW]);

  const startW = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragW.current = { x: e.clientX, pct: splitPct, width: 0 };
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

  const onMoveH = useCallback((e: PointerEvent) => {
    const st = dragH.current;
    if (!st) return;
    const dy = e.clientY - st.y;
    setPreviewH(Math.min(720, Math.max(180, st.h + dy)));
  }, []);

  const endH = useCallback(() => {
    dragH.current = null;
    window.removeEventListener("pointermove", onMoveH);
    window.removeEventListener("pointerup", endH);
    window.removeEventListener("pointercancel", endH);
  }, [onMoveH]);

  const startH = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragH.current = { y: e.clientY, h: previewH };
      window.addEventListener("pointermove", onMoveH);
      window.addEventListener("pointerup", endH);
      window.addEventListener("pointercancel", endH);
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* */
      }
    },
    [endH, onMoveH, previewH]
  );

  return (
    <div className={cn("flex min-h-0 w-full flex-col gap-3", className)}>
      <div
        ref={rowRef}
        className="flex min-h-0 w-full flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0"
      >
        <div
          className="flex min-h-0 w-full min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm lg:shrink-0"
          style={isLg ? { width: `${splitPct}%` } : undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Výkres / PDF
            </span>
            <span className="text-[11px] text-slate-400">Výšku měňte táhlem níže</span>
          </div>
          <div
            className="min-h-0 overflow-auto"
            style={{ height: previewH, maxHeight: "min(70vh, 720px)" }}
          >
            {leftPanel}
          </div>
          <button
            type="button"
            aria-label="Změnit výšku panelu náhledu"
            className="flex h-3 w-full cursor-row-resize items-center justify-center border-t border-slate-200 bg-slate-100 hover:bg-slate-200"
            onPointerDown={startH}
          >
            <GripVertical className="h-3 w-3 rotate-90 text-slate-500" aria-hidden />
          </button>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Změnit šířku panelů"
          className="hidden w-2 shrink-0 cursor-col-resize items-center justify-center bg-slate-200 hover:bg-slate-300 lg:flex"
          onPointerDown={startW}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/80 p-3 shadow-sm sm:p-4">
          {rightPanel}
        </div>
      </div>

      <div className="w-full shrink-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        {bottomPanel}
      </div>
    </div>
  );
}
