"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Maximize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

const FRAME_STORAGE_PREFIX = "annotationEditorFrame:v1:";

export type DesktopAnnotationFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  maximized: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function defaultFrame(): DesktopAnnotationFrame {
  if (typeof window === "undefined") {
    return { left: 40, top: 40, width: 1120, height: 720, maximized: false };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = clamp(Math.round(vw * 0.9), 800, Math.min(1400, vw - 16));
  const height = clamp(Math.round(vh * 0.85), 600, Math.min(900, vh - 16));
  const left = Math.round((vw - width) / 2);
  const top = Math.round((vh - height) / 2);
  return { left, top, width, height, maximized: false };
}

function clampFrameToViewport(f: DesktopAnnotationFrame): DesktopAnnotationFrame {
  if (typeof window === "undefined") return f;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  if (f.maximized) return { ...f, maximized: true };
  const w = clamp(f.width, 800, vw - margin * 2);
  const h = clamp(f.height, 600, vh - margin * 2);
  const left = clamp(f.left, margin, Math.max(margin, vw - w - margin));
  const top = clamp(f.top, margin, Math.max(margin, vh - h - margin));
  return { left, top, width: w, height: h, maximized: false };
}

/**
 * Jednotné okno editoru anotací (zakázka, měření, fotodokumentace).
 * Desktop: vycentrované / posuvné / roztahovatelné okno nad layoutem.
 * Mobil: fullscreen.
 */
export type UnifiedAnnotationEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isTouchUI: boolean;
  /** Klíč pro localStorage (např. companyId:userId) */
  persistenceKey?: string | null;
  children: React.ReactNode;
};

export function UnifiedAnnotationEditor({
  open,
  onOpenChange,
  isTouchUI,
  persistenceKey,
  children,
}: UnifiedAnnotationEditorProps) {
  const [frame, setFrame] = React.useState<DesktopAnnotationFrame>(() => defaultFrame());
  const frameBeforeMaxRef = React.useRef<DesktopAnnotationFrame | null>(null);
  const dragRef = React.useRef<{
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const resizeRef = React.useRef<{
    startClientX: number;
    startClientY: number;
    startW: number;
    startH: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  const readStoredFrame = React.useCallback((): DesktopAnnotationFrame | null => {
    if (!persistenceKey || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(FRAME_STORAGE_PREFIX + persistenceKey);
      if (!raw) return null;
      const j = JSON.parse(raw) as Partial<DesktopAnnotationFrame>;
      if (
        typeof j.left === "number" &&
        typeof j.top === "number" &&
        typeof j.width === "number" &&
        typeof j.height === "number"
      ) {
        return clampFrameToViewport({
          left: j.left,
          top: j.top,
          width: j.width,
          height: j.height,
          maximized: Boolean(j.maximized),
        });
      }
    } catch {
      /* */
    }
    return null;
  }, [persistenceKey]);

  const persistFrame = React.useCallback(
    (f: DesktopAnnotationFrame) => {
      if (!persistenceKey || typeof window === "undefined") return;
      try {
        if (f.maximized) return;
        window.localStorage.setItem(
          FRAME_STORAGE_PREFIX + persistenceKey,
          JSON.stringify({ left: f.left, top: f.top, width: f.width, height: f.height, maximized: false })
        );
      } catch {
        /* */
      }
    },
    [persistenceKey]
  );

  React.useEffect(() => {
    if (!open || isTouchUI) return;
    const stored = readStoredFrame();
    setFrame(clampFrameToViewport(stored ?? defaultFrame()));
  }, [open, isTouchUI, readStoredFrame]);

  React.useEffect(() => {
    if (!open || isTouchUI) return;
    const onResize = () => {
      setFrame((prev) => clampFrameToViewport(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, isTouchUI]);

  const onTitlePointerDown = React.useCallback(
    (ev: React.PointerEvent) => {
      if (isTouchUI || frame.maximized) return;
      ev.preventDefault();
      dragRef.current = {
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startLeft: frame.left,
        startTop: frame.top,
      };
      try {
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      } catch {
        /* */
      }
    },
    [isTouchUI, frame.left, frame.top, frame.maximized]
  );

  const onTitlePointerMove = React.useCallback(
    (ev: React.PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      ev.preventDefault();
      const dx = ev.clientX - st.startClientX;
      const dy = ev.clientY - st.startClientY;
      setFrame((f) => {
        if (f.maximized) return f;
        const next = clampFrameToViewport({
          ...f,
          left: st.startLeft + dx,
          top: st.startTop + dy,
        });
        return next;
      });
    },
    []
  );

  const onTitlePointerUp = React.useCallback(
    (ev: React.PointerEvent) => {
      if (dragRef.current) {
        dragRef.current = null;
        try {
          (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
        } catch {
          /* */
        }
        setFrame((f) => {
          const c = clampFrameToViewport(f);
          persistFrame(c);
          return c;
        });
      }
    },
    [persistFrame]
  );

  const onResizePointerDown = React.useCallback(
    (ev: React.PointerEvent) => {
      if (isTouchUI || frame.maximized) return;
      ev.preventDefault();
      ev.stopPropagation();
      resizeRef.current = {
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startW: frame.width,
        startH: frame.height,
        startLeft: frame.left,
        startTop: frame.top,
      };
      const onMove = (e: PointerEvent) => {
        const st = resizeRef.current;
        if (!st) return;
        const dw = e.clientX - st.startClientX;
        const dh = e.clientY - st.startClientY;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        const w = clamp(st.startW + dw, 800, vw - margin * 2);
        const h = clamp(st.startH + dh, 600, vh - margin * 2);
        setFrame((f) =>
          clampFrameToViewport({
            ...f,
            width: w,
            height: h,
            left: st.startLeft,
            top: st.startTop,
          })
        );
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setFrame((f) => {
          const c = clampFrameToViewport(f);
          persistFrame(c);
          return c;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [isTouchUI, frame.width, frame.height, frame.left, frame.top, persistFrame]
  );

  const resetFrame = React.useCallback(() => {
    const d = defaultFrame();
    setFrame(clampFrameToViewport(d));
    persistFrame(d);
  }, [persistFrame]);

  const toggleMaximized = React.useCallback(() => {
    setFrame((f) => {
      if (f.maximized) {
        const prev = frameBeforeMaxRef.current;
        frameBeforeMaxRef.current = null;
        return clampFrameToViewport(prev ?? defaultFrame());
      }
      frameBeforeMaxRef.current = {
        left: f.left,
        top: f.top,
        width: f.width,
        height: f.height,
        maximized: false,
      };
      return { ...f, maximized: true };
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "!flex min-h-0 flex-col gap-0 !overflow-hidden overscroll-contain",
          "!border-0 !p-0 !shadow-none",
          "data-[state=open]:animate-none data-[state=closed]:animate-none",
          isTouchUI
            ? cn(
                "!fixed !inset-0 !left-0 !top-0 !h-[100dvh] !max-h-[100dvh] !w-full !max-w-none !translate-x-0 !translate-y-0 z-[500]",
                "rounded-none bg-slate-950 text-white ring-0"
              )
            : cn(
                "!fixed !inset-0 !left-0 !top-0 !h-[100dvh] !max-h-[100dvh] !w-full !max-w-none !translate-x-0 !translate-y-0 z-[500]",
                "rounded-none bg-black/45 p-0 ring-0",
                "pointer-events-auto"
              )
        )}
      >
        {isTouchUI ? (
          <div className="relative flex h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-1 flex-col overflow-hidden">
            {children}
          </div>
        ) : (
          <div className="pointer-events-none relative flex min-h-0 w-full flex-1 items-center justify-center p-2 sm:p-3">
            <div
              className={cn(
                "pointer-events-auto relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-background text-foreground shadow-2xl ring-1 ring-slate-950/10",
                frame.maximized ? "absolute inset-3 h-auto w-auto" : ""
              )}
              style={
                frame.maximized
                  ? undefined
                  : {
                      position: "absolute",
                      left: frame.left,
                      top: frame.top,
                      width: frame.width,
                      height: frame.height,
                    }
              }
            >
              <div
                className="flex shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-border bg-muted/40 px-2 py-1.5 active:cursor-grabbing"
                onPointerDown={onTitlePointerDown}
                onPointerMove={onTitlePointerMove}
                onPointerUp={onTitlePointerUp}
                onPointerCancel={onTitlePointerUp}
              >
                <span className="truncate text-xs font-medium text-muted-foreground">
                  Editor anotací — přetáhněte za lištu
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMaximized();
                    }}
                    title={frame.maximized ? "Obnovit okno" : "Na celou obrazovku"}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetFrame();
                    }}
                    title="Reset pozice a velikosti"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
              {!frame.maximized ? (
                <button
                  type="button"
                  aria-label="Změnit velikost okna editoru"
                  className="absolute bottom-1.5 right-1.5 z-[30] flex h-8 w-8 cursor-nwse-resize items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow hover:bg-accent"
                  onPointerDown={onResizePointerDown}
                >
                  <span className="select-none text-sm leading-none" aria-hidden>
                    ⤡
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
