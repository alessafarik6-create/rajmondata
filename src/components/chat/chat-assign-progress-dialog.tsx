"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";

export type AssignProgressPhase =
  | "idle"
  | "prepare"
  | "upload"
  | "save"
  | "success"
  | "error";

type Props = {
  open: boolean;
  jobLabel: string;
  fileLabel: string;
  fileSizeBytes?: number;
  isVideo?: boolean;
  phase: AssignProgressPhase;
  progressPct: number | null;
  folderName?: string | null;
  jobId?: string | null;
  errorMessage?: string | null;
  onRetry?: () => void;
  onDone: () => void;
};

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function ChatAssignProgressDialog({
  open,
  jobLabel,
  fileLabel,
  fileSizeBytes,
  isVideo,
  phase,
  progressPct,
  folderName,
  jobId,
  errorMessage,
  onRetry,
  onDone,
}: Props) {
  const busy = phase === "prepare" || phase === "upload" || phase === "save";
  const sizeLabel = formatSize(fileSizeBytes);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        {phase === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                Přiřazeno k zakázce
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-sm text-foreground pt-2">
                  <p className="font-medium">{jobLabel}</p>
                  {folderName ? (
                    <p>
                      Složka: <span className="font-medium">{folderName}</span>
                    </p>
                  ) : null}
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              {jobId ? (
                <Button asChild variant="default" className="w-full sm:w-auto">
                  <Link href={`/portal/jobs/${encodeURIComponent(jobId)}`}>Otevřít zakázku</Link>
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onDone}>
                Hotovo
              </Button>
            </DialogFooter>
          </>
        ) : phase === "error" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                Přiřazení se nepodařilo
              </DialogTitle>
              <DialogDescription>
                Soubor se nepodařilo přiřadit k zakázce.
                {errorMessage ? ` ${errorMessage}` : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              {onRetry ? (
                <Button type="button" onClick={onRetry}>
                  Zkusit znovu
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onDone}>
                Zrušit
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Přiřazuji k zakázce</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-1 pt-1 text-sm">
                  <p className="font-medium text-foreground">{jobLabel}</p>
                  <p className="text-muted-foreground truncate">
                    {isVideo ? "🎥 " : ""}
                    {fileLabel}
                    {sizeLabel ? ` · ${sizeLabel}` : ""}
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>
                  {phase === "prepare"
                    ? "Připravuji soubor…"
                    : phase === "upload"
                      ? isVideo
                        ? "Nahrávám video…"
                        : "Nahrávám soubor…"
                      : "Ukládám do zakázky…"}
                </span>
              </div>
              {progressPct != null ? (
                <div className="space-y-1">
                  <Progress value={progressPct} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">{progressPct} %</p>
                </div>
              ) : (
                <Progress value={undefined} className="h-2 animate-pulse" />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Simuluje průběh při server-side kopírování (bez xhr progress). */
export function useSimulatedAssignProgress(active: boolean) {
  const [phase, setPhase] = useState<AssignProgressPhase>("idle");
  const [progressPct, setProgressPct] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setPhase("idle");
      setProgressPct(null);
      return;
    }
    setPhase("prepare");
    setProgressPct(5);
    const t1 = window.setTimeout(() => {
      setPhase("upload");
      setProgressPct(25);
    }, 400);
    const t2 = window.setTimeout(() => setProgressPct(55), 900);
    const t3 = window.setTimeout(() => setProgressPct(75), 1400);
    const t4 = window.setTimeout(() => {
      setPhase("save");
      setProgressPct(90);
    }, 1800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [active]);

  return { phase, setPhase, progressPct, setProgressPct };
}
