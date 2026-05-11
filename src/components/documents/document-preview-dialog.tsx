"use client";

import React, { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export type DocumentPreviewKind = "image" | "pdf" | "unsupported";

function inferPreviewKind(
  mimeType: string | null | undefined,
  fileName: string | null | undefined
): DocumentPreviewKind {
  const m = (mimeType || "").trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || m.includes("pdf")) return "pdf";
  const n = (fileName || "").toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return "image";
  if (/\.pdf$/i.test(n)) return "pdf";
  return "unsupported";
}

export function DocumentPreviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fileUrl: string;
  mimeType?: string | null;
  fileName?: string | null;
}) {
  const { open, onOpenChange, title, fileUrl, mimeType, fileName } = props;

  const kind = useMemo(
    () => inferPreviewKind(mimeType, fileName),
    [mimeType, fileName]
  );

  const safeName = (fileName || title || "soubor").replace(/[\\/]/g, "-");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,900px)] w-[min(96vw,56rem)] flex-col gap-3 p-4 sm:p-6">
        <DialogHeader className="shrink-0 space-y-1 pr-10 text-left">
          <DialogTitle className="line-clamp-2 text-base">{title}</DialogTitle>
        </DialogHeader>
        {kind === "image" ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl}
              alt={title}
              className="mx-auto max-h-[min(78dvh,720px)] w-auto max-w-full object-contain"
            />
          </div>
        ) : null}
        {kind === "pdf" ? (
          <div className="min-h-[min(72dvh,680px)] flex-1 overflow-hidden rounded-md border bg-white">
            <iframe
              title={title}
              src={fileUrl}
              className="h-full min-h-[min(72dvh,680px)] w-full border-0"
            />
          </div>
        ) : null}
        {kind === "unsupported" ? (
          <div className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            Tento typ souboru nelze v prohlížeči spolehlivě zobrazit. Použijte stažení a otevřete soubor v
            aplikaci na svém zařízení.
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zavřít
          </Button>
          <Button type="button" variant="default" asChild>
            <a href={fileUrl} download={safeName} target="_blank" rel="noopener noreferrer">
              <Download className="mr-2 h-4 w-4" />
              Stáhnout
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
