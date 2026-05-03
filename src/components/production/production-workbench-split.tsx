"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOP_H_MIN = 380;
const TOP_H_DEFAULT = 550;
const TOP_VIEWPORT_RESERVE = 240;

export type ProductionWorkbenchHeights = {
  splitPct: number;
  topPanelHeight: number;
};

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
  storageKeyPrefix: string;
  className?: string;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
  /** Vyplní výšku rodiče (bez vlastního lg:h-[calc…]) — pro obal s pevnou výškou */
  fillContainerHeight?: boolean;
  /** Řízené rozměry z Firestore / nadřazeného stavu */
  controlledHeights?: ProductionWorkbenchHeights | null;
  onControlledHeightsChange?: (patch: Partial<ProductionWorkbenchHeights>) => void;
  /** Nepersistovat do localStorage (persistuje rodič) */
  disableLocalStorage?: boolean;
};

export function ProductionWorkbenchSplit({
  storageKeyPrefix,
  className,
  leftPanel,
  rightPanel,
  bottomPanel,
  fillContainerHeight = false,
  controlledHeights = null,
  onControlledHeightsChange,
  disableLocalStorage = false,
}: ProductionWorkbenchSplitProps) {
  const [splitPctInternal, setSplitPctInternal] = useState(46);
  const [topPanelHeightInternal, setTopPanelHeightInternal] = useState(TOP_H_DEFAULT);
  const splitPct = controlledHeights?.splitPct ?? splitPctInternal;
  const topPanelHeight = controlledHeights?.topPanelHeight ?? topPanelHeightInternal;

  const setSplitPct = useCallback(
    (v: number) => {
      if (controlledHeights && onControlledHeightsChange) {
        onControlledHeightsChange({ splitPct: v });
      } else {
        setSplitPctInternal(v);
      }
    },
    [controlledHeights, onControlledHeightsChange]
  );

  const setTopPanelHeight = useCallback(
    (v: number) => {
      if (controlledHeights && onControlledHeightsChange) {
        onControlledHeightsChange({ topPanelHeight: v });
      } else {
        setTopPanelHeightInternal(v);
      }
    },
    [controlledHeights, onControlledHeightsChange]
  );

  const [topMax, setTopMax] = useState(() =>
    typeof window !== "undefined" ? Math.max(TOP_H_MIN, window.innerHeight - TOP_VIEWPORT_RESERVE) : 800
  );
  const [drawingVisible, setDrawingVisible] = useState(true);

  const dragW = useRef<{ x: number; pct: number } | null>(null);
  const dragH = useRef<{ y: number; h: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isLg = useIsLg();

  useEffect(() => {
    const syncTopMax = () =>
      Math.max(TOP_H_MIN, typeof window !== "undefined" ? window.innerHeight - TOP_VIEWPORT_RESERVE : TOP_H_MIN);
    const onResize = () => setTopMax(syncTopMax());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (controlledHeights) return;
    setTopPanelHeightInternal((h) => Math.min(Math.max(h, TOP_H_MIN), topMax));
  }, [topMax, controlledHeights]);

  useEffect(() => {
    if (disableLocalStorage) return;
    try {
      const w = localStorage.getItem(`${storageKeyPrefix}-w`);
      if (w && !controlledHeights) {
        const n = Number(w);
        if (Number.isFinite(n)) setSplitPctInternal(Math.min(72, Math.max(28, n)));
      }
      const t = localStorage.getItem(`${storageKeyPrefix}-top`);
      if (t && !controlledHeights) {
        const n = Number(t);
        if (Number.isFinite(n)) {
          const max = Math.max(TOP_H_MIN, window.innerHeight - TOP_VIEWPORT_RESERVE);
          setTopPanelHeightInternal(Math.min(Math.max(n, TOP_H_MIN), max));
        }
      }
    } catch {
      /* ignore */
    }
  }, [storageKeyPrefix, disableLocalStorage, controlledHeights]);

  useEffect(() => {
    if (disableLocalStorage) return;
    try {
      localStorage.setItem(`${storageKeyPrefix}-w`, String(splitPct));
    } catch {
      /* ignore */
    }
  }, [storageKeyPrefix, splitPct, disableLocalStorage]);

  useEffect(() => {
    if (disableLocalStorage) return;
    try {
      localStorage.setItem(`${storageKeyPrefix}-top`, String(topPanelHeight));
    } catch {
      /* ignore */
    }
  }, [storageKeyPrefix, topPanelHeight, disableLocalStorage]);

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
    [setSplitPct]
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

  const onMoveH = useCallback(
    (e: PointerEvent) => {
      const st = dragH.current;
      if (!st) return;
      const dy = e.clientY - st.y;
      const next = Math.min(topMax, Math.max(TOP_H_MIN, st.h + dy));
      setTopPanelHeight(next);
    },
    [topMax, setTopPanelHeight]
  );

  const endH = useCallback(() => {
    dragH.current = null;
    window.removeEventListener("pointermove", onMoveH);
    window.removeEventListener("pointerup", endH);
    window.removeEventListener("pointercancel", endH);
  }, [onMoveH]);

  const startH = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragH.current = { y: e.clientY, h: topPanelHeight };
      window.addEventListener("pointermove", onMoveH);
      window.addEventListener("pointerup", endH);
      window.addEventListener("pointercancel", endH);
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* */
      }
    },
    [endH, onMoveH, topPanelHeight]
  );

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col gap-0 overflow-hidden",
        fillContainerHeight ? "h-full min-h-0 flex-1" : "lg:h-[min(900px,calc(100dvh-200px))] lg:max-h-[calc(100dvh-7rem)]",
        className
      )}
    >
      <div
        className="flex w-full shrink-0 flex-col overflow-hidden min-h-0"
        style={
          isLg
            ? {
                height: topPanelHeight,
                minHeight: TOP_H_MIN,
                maxHeight: topMax,
              }
            : undefined
        }
      >
        {isLg ? (
          <div className="flex shrink-0 items-center justify-end border-b border-slate-200 bg-slate-50 px-2 py-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-slate-700"
              onClick={() => setDrawingVisible((v) => !v)}
            >
              {drawingVisible ? "Skrýt výkres" : "Zobrazit výkres"}
            </Button>
          </div>
        ) : null}

        <div
          ref={rowRef}
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden lg:flex-row lg:items-stretch"
          )}
        >
          {drawingVisible ? (
            <>
              <div
                className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:shrink-0"
                style={
                  isLg
                    ? { width: `${splitPct}%`, minWidth: 0, minHeight: 0, height: "100%" }
                    : { minHeight: "min(42vh, 420px)", maxHeight: "48vh" }
                }
              >
                <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{leftPanel}</div>
              </div>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Změnit šířku panelů výkres a sklad"
                className="hidden w-2 shrink-0 cursor-col-resize flex-col items-center justify-center border-y border-slate-200 bg-slate-100 hover:bg-slate-200 lg:flex"
                onPointerDown={startW}
              />
            </>
          ) : null}

          <div
            className={cn(
              "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/90 shadow-sm",
              "min-h-[min(52vh,520px)] lg:min-h-0 lg:max-h-none",
              isLg && "h-full min-h-0"
            )}
          >
            {rightPanel}
          </div>
        </div>
      </div>

      {isLg ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Změnit výšku horního panelu (výkres a sklad) oproti seznamu materiálu"
          className="flex h-2 w-full shrink-0 cursor-row-resize items-center justify-center border-y border-slate-200 bg-slate-100 hover:bg-slate-200"
          onPointerDown={startH}
        />
      ) : null}

      <div
        className={cn(
          "mt-2 w-full rounded-lg border border-slate-200 bg-white shadow-sm sm:mt-3",
          "lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden lg:min-h-[12rem]"
        )}
      >
        <div className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain lg:flex-1">{bottomPanel}</div>
      </div>
    </div>
  );
}
