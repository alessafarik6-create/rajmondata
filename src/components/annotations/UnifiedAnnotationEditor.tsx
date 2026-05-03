"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Jednotné okno editoru anotací (zakázka, měření, fotodokumentace).
 * Logika stavu zůstává v rodiči; tento komponent řeší layout, centrování na desktopu
 * a fullscreen na mobilu — bez vstupní animace „zoom“ (žádná „lupa“ z dialogu).
 */
export type UnifiedAnnotationEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isTouchUI: boolean;
  /** Velikost vnitřního panelu na desktopu (px). Na mobilu se ignoruje. */
  desktopPanel: { w: number; h: number } | null;
  onDesktopResizePointerDown: React.PointerEventHandler<HTMLButtonElement> | undefined;
  children: React.ReactNode;
};

export function UnifiedAnnotationEditor({
  open,
  onOpenChange,
  isTouchUI,
  desktopPanel,
  onDesktopResizePointerDown,
  children,
}: UnifiedAnnotationEditorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "!flex min-h-0 flex-col gap-0 !overflow-hidden overscroll-contain",
          "max-lg:!fixed max-lg:!inset-0 max-lg:!left-0 max-lg:!top-0 max-lg:z-[200] max-lg:h-[100dvh] max-lg:min-h-[100dvh] max-lg:max-h-[100dvh] max-lg:w-[100vw] max-lg:max-w-[100vw] max-lg:!translate-x-0 max-lg:!translate-y-0 max-lg:rounded-none max-lg:border-0 max-lg:bg-slate-950 max-lg:p-0 max-lg:text-white max-lg:shadow-none max-lg:pointer-events-auto",
          "lg:!fixed lg:inset-0 lg:z-[260] lg:flex lg:items-center lg:justify-center lg:border-0 lg:bg-black/40 lg:p-4 lg:text-foreground lg:shadow-none lg:ring-0 lg:!overflow-hidden lg:pointer-events-none"
        )}
      >
        <div
          className={cn(
            "relative flex min-h-0 flex-col overflow-hidden",
            "max-lg:h-full max-lg:max-h-[100dvh] max-lg:w-full max-lg:min-h-0 max-lg:flex-1",
            "lg:pointer-events-auto lg:flex-none lg:overflow-hidden lg:rounded-lg lg:border lg:border-slate-200 lg:bg-background lg:shadow-xl lg:ring-1 lg:ring-slate-950/[0.08]"
          )}
          style={
            !isTouchUI && desktopPanel
              ? {
                  position: "fixed",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: desktopPanel.w,
                  height: desktopPanel.h,
                  maxWidth: "calc(100vw - 32px)",
                  maxHeight: "calc(100vh - 32px)",
                  resize: "both" as const,
                  overflow: "auto" as const,
                }
              : undefined
          }
        >
          {!isTouchUI ? (
            <button
              type="button"
              aria-label="Změnit velikost okna editoru"
              className="absolute bottom-2 right-2 z-[300] hidden h-9 w-9 cursor-nwse-resize items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground shadow-md hover:bg-accent lg:flex"
              onPointerDown={onDesktopResizePointerDown}
            >
              <span className="select-none text-sm leading-none" aria-hidden>
                ⤡
              </span>
            </button>
          ) : null}
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
