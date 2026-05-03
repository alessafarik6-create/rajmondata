"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

/**
 * Fullscreen náhled výkresu (PDF v iframe — pinch zoom v prohlížeči; obrázek v posuvné ploše).
 * Rezerva dole kvůli mobilní navigaci portálu.
 */
export function ProductionDrawingFullscreenDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title: string;
  kind: "pdf" | "image";
}) {
  const u = String(props.url || "").trim();
  const bottomPad = "calc(96px + env(safe-area-inset-bottom, 0px))";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-slate-950 p-0 text-slate-100 sm:max-w-full [&>button.absolute]:hidden"
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-slate-700 bg-slate-900 px-3 py-2 pr-14">
          <DialogTitle className="truncate text-left text-sm font-semibold text-slate-100 sm:text-base">
            {props.title}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-11 w-11 rounded-full text-slate-200 hover:bg-slate-800 hover:text-white"
            aria-label="Zavřít"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="h-6 w-6" />
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 w-full bg-slate-950" style={{ paddingBottom: bottomPad }}>
          {!u ? (
            <p className="p-4 text-sm text-slate-400">Chybí odkaz na soubor.</p>
          ) : props.kind === "pdf" ? (
            <iframe
              title={props.title}
              src={`${u}#view=FitH`}
              className="h-full min-h-[50vh] w-full border-0 bg-slate-950"
              allow="fullscreen"
            />
          ) : (
            <div className="flex h-full min-h-[50vh] flex-col overflow-hidden">
              <div className="shrink-0 border-b border-slate-800 px-3 py-2">
                <Button type="button" variant="secondary" size="sm" className="w-full sm:w-auto" asChild>
                  <a href={u} target="_blank" rel="noreferrer">
                    Otevřít v novém okně (pinch zoom)
                  </a>
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-black/40 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u}
                  alt={props.title}
                  className="mx-auto block max-h-none min-h-[40vh] w-auto max-w-[min(100%,100vw)] object-contain"
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
