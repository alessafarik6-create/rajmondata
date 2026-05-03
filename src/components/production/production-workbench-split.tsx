"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Výška horního panelu (PDF + výběr materiálu) — px */
const TOP_H_MIN = 420;
const TOP_H_DEFAULT = 600;
/** Max výška horního panelu = vh minus rezerva (shodně s tahem) */
const TOP_VIEWPORT_RESERVE = 160;

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
  fillContainerHeight?: boolean;
  controlledHeights?: ProductionWorkbenchHeights | null;
  onControlledHeightsChange?: (patch: Partial<ProductionWorkbenchHeights>) => void;
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

  const setTopPanelHeightRef = useRef(setTopPanelHeight);
  useEffect(() => {
    setTopPanelHeightRef.current = setTopPanelHeight;
  }, [setTopPanelHeight]);

  const [topMax, setTopMax] = useState(() =>
    typeof window !== "undefined"
      ? Math.max(TOP_H_MIN, window.innerHeight - TOP_VIEWPORT_RESERVE)
      : TOP_H_DEFAULT + 200
  );
  const [drawingVisible, setDrawingVisible] = useState(true);

  const dragW = useRef<{ x: number; pct: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isLg = useIsLg();

  /** Vertikální resize: refy musí přežít re-render, aby window listenery nebyly shozeny. */
  const isResizingVerticalRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const verticalMoveImplRef = useRef<(e: MouseEvent) => void>(() => {});
  const verticalUpImplRef = useRef<() => void>(() => {});

  const onStableVerticalMove = useCallback((e: MouseEvent) => {
    verticalMoveImplRef.current(e);
  }, []);

  const onStableVerticalUp = useCallback(() => {
    verticalUpImplRef.current();
  }, []);

  useEffect(() => {
    verticalMoveImplRef.current = (e: MouseEvent) => {
      if (!isResizingVerticalRef.current) return;
      const delta = e.clientY - startYRef.current;
      let newHeight = startHeightRef.current + delta;
      const maxH = Math.max(TOP_H_MIN, window.innerHeight - TOP_VIEWPORT_RESERVE);
      newHeight = Math.min(maxH, Math.max(TOP_H_MIN, newHeight));
      setTopPanelHeightRef.current(newHeight);
    };
    verticalUpImplRef.current = () => {
      if (!isResizingVerticalRef.current) return;
      isResizingVerticalRef.current = false;
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
      window.removeEventListener("mousemove", onStableVerticalMove);
      window.removeEventListener("mouseup", onStableVerticalUp);
    };
  }, [onStableVerticalMove, onStableVerticalUp]);

  const onPointerMoveWImplRef = useRef<(e: PointerEvent) => void>(() => {});
  const onPointerEndWImplRef = useRef<() => void>(() => {});

  const onStablePointerMoveW = useCallback((e: PointerEvent) => {
    onPointerMoveWImplRef.current(e);
  }, []);

  const onStablePointerEndW = useCallback(() => {
    onPointerEndWImplRef.current();
  }, []);

  useEffect(() => {
    onPointerMoveWImplRef.current = (e: PointerEvent) => {
      const st = dragW.current;
      const row = rowRef.current;
      if (!st || !row) return;
      const rect = row.getBoundingClientRect();
      const dx = e.clientX - st.x;
      const deltaPct = (dx / rect.width) * 100;
      setSplitPct(Math.min(72, Math.max(28, st.pct + deltaPct)));
    };
    onPointerEndWImplRef.current = () => {
      if (dragW.current === null) return;
      dragW.current = null;
      window.removeEventListener("pointermove", onStablePointerMoveW);
      window.removeEventListener("pointerup", onStablePointerEndW);
      window.removeEventListener("pointercancel", onStablePointerEndW);
    };
  }, [onStablePointerMoveW, onStablePointerEndW, setSplitPct]);

  useEffect(() => {
    const syncTopMax = () =>
      Math.max(
        TOP_H_MIN,
        typeof window !== "undefined" ? window.innerHeight - TOP_VIEWPORT_RESERVE : TOP_H_MIN
      );
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

  const startW = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragW.current = { x: e.clientX, pct: splitPct };
      window.addEventListener("pointermove", onStablePointerMoveW);
      window.addEventListener("pointerup", onStablePointerEndW);
      window.addEventListener("pointercancel", onStablePointerEndW);
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* */
      }
    },
    [onStablePointerMoveW, onStablePointerEndW, splitPct]
  );

  const startVerticalResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingVerticalRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = topPanelHeight;
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "none";
        document.body.style.cursor = "row-resize";
      }
      window.addEventListener("mousemove", onStableVerticalMove);
      window.addEventListener("mouseup", onStableVerticalUp);
    },
    [topPanelHeight, onStableVerticalMove, onStableVerticalUp]
  );

  const applyLargeTopMode = useCallback(() => {
    setTopPanelHeight(topMax);
  }, [topMax, setTopPanelHeight]);

  useEffect(() => {
    return () => {
      verticalUpImplRef.current();
      onPointerEndWImplRef.current();
    };
  }, []);

  const rightColumn = (
    <div
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/90 shadow-sm",
        "min-h-[min(52vh,520px)] lg:min-h-0 lg:h-full lg:max-h-none"
      )}
    >
      {rightPanel}
    </div>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col gap-0 overflow-hidden",
        fillContainerHeight ? "h-full min-h-0 flex-1" : "lg:h-[min(900px,calc(100dvh-200px))] lg:max-h-[calc(100dvh-7rem)]",
        className
      )}
    >
      {/* Horní blok: výška = PDF + sklad (nezávislá na spodní frontě) */}
      <div
        className={cn(
          "flex w-full shrink-0 flex-col overflow-hidden min-h-0",
          isLg && "lg:grid lg:grid-rows-[auto_minmax(0,1fr)]"
        )}
        style={
          isLg
            ? {
                height: topPanelHeight,
                minHeight: TOP_H_MIN,
                maxHeight: topMax,
                overflow: "hidden",
              }
            : undefined
        }
      >
        {isLg ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1 lg:min-h-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={applyLargeTopMode}
            >
              Velký režim (A4)
            </Button>
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

        {!isLg ? (
          <div ref={rowRef} className="flex min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden lg:min-h-0">
            {drawingVisible ? (
              <div
                className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                style={{ minHeight: "min(42vh, 420px)", maxHeight: "48vh" }}
              >
                <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{leftPanel}</div>
              </div>
            ) : null}
            {rightColumn}
          </div>
        ) : drawingVisible ? (
          <div
            ref={rowRef}
            className="grid min-h-0 w-full flex-1 overflow-hidden"
            style={{
              gridTemplateColumns: `${splitPct}fr 8px ${100 - splitPct}fr`,
              height: "100%",
              minHeight: 0,
            }}
          >
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{leftPanel}</div>
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Změnit šířku panelů výkres a sklad"
              className="flex min-h-0 w-2 cursor-col-resize flex-col items-center justify-center border-y border-slate-200 bg-slate-100 hover:bg-slate-200"
              onPointerDown={startW}
            />
            {rightColumn}
          </div>
        ) : (
          <div ref={rowRef} className="grid min-h-0 w-full flex-1 grid-cols-1 overflow-hidden">
            {rightColumn}
          </div>
        )}
      </div>

      {isLg ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Změnit výšku panelu výkres a výběr materiálu"
          title="Tažením změníte výšku celého panelu (výkres + výběr materiálu)"
          className="h-2 w-full shrink-0 cursor-row-resize select-none bg-transparent hover:bg-black/10"
          onMouseDown={startVerticalResize}
        />
      ) : null}

      <div
        className={cn(
          "mt-2 w-full rounded-lg border border-slate-200 bg-white shadow-sm sm:mt-3",
          "lg:mt-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden lg:min-h-[12rem]"
        )}
      >
        <div className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain lg:flex-1">{bottomPanel}</div>
      </div>
    </div>
  );
}
