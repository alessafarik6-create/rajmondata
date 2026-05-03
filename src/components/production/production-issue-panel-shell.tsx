"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OUTER_MIN = 500;

type ProductionIssuePanelShellProps = {
  className?: string;
  /** Výška celého panelu v px (desktop); null = auto */
  heightPx: number | null;
  onHeightPxChange: (px: number) => void;
  children: React.ReactNode;
};

/**
 * Obal karty „Výdej ve výrobě“: tahem od spodu mění výšku celého pracovního boxu.
 */
export function ProductionIssuePanelShell({
  className,
  heightPx,
  onHeightPxChange,
  children,
}: ProductionIssuePanelShellProps) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [maxH, setMaxH] = useState(900);

  useEffect(() => {
    const sync = () => {
      const v = typeof window !== "undefined" ? window.innerHeight : 800;
      setMaxH(Math.max(OUTER_MIN + 120, v - 72));
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const st = drag.current;
      if (!st) return;
      const dy = e.clientY - st.y;
      const next = Math.min(maxH, Math.max(OUTER_MIN, st.h + dy));
      onHeightPxChange(next);
    },
    [maxH, onHeightPxChange]
  );

  const end = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  }, [onMove]);

  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const h = heightPx ?? Math.min(680, maxH);
      drag.current = { y: e.clientY, h };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* */
      }
    },
    [end, heightPx, maxH, onMove]
  );

  const applyLargeMode = useCallback(() => {
    const target = Math.min(maxH, Math.floor((typeof window !== "undefined" ? window.innerHeight : 800) * 0.88));
    onHeightPxChange(Math.max(OUTER_MIN, target));
  }, [maxH, onHeightPxChange]);

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50/40 shadow-sm",
        heightPx == null ? "min-h-0" : "",
        className
      )}
      style={
        heightPx != null ? { height: heightPx, minHeight: OUTER_MIN, maxHeight: maxH } : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      <div className="hidden shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-100/90 px-2 py-1 lg:flex">
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={applyLargeMode}>
          Velký režim (A4)
        </Button>
        <span className="hidden text-[10px] text-slate-500 sm:inline">Tažením změníte výšku celého panelu</span>
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Změnit výšku panelu Výdej ve výrobě"
        className="hidden h-2 w-full shrink-0 cursor-row-resize items-center justify-center border-t border-slate-300 bg-slate-200 hover:bg-slate-300 lg:flex"
        onPointerDown={start}
      />
    </div>
  );
}
