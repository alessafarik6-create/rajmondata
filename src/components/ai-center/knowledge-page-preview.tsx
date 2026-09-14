"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Maximize2 } from "lucide-react";
import { renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  pdfUrl: string;
  pageNumber: number;
  alt?: string;
  className?: string;
  compact?: boolean;
};

export function KnowledgePagePreview({
  pdfUrl,
  pageNumber,
  alt = "Náhled stránky manuálu",
  className,
  compact,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    async function load() {
      if (!pdfUrl || pageNumber < 1) {
        setLoading(false);
        setError("Náhled není k dispozici.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const blobs = await renderPdfPagesToPngBlobs(pdfUrl, [pageNumber], compact ? 1.2 : 1.8);
        if (cancelled) return;
        if (!blobs[0]) throw new Error("Stránku se nepodařilo vykreslit.");
        const url = URL.createObjectURL(blobs[0]);
        revoked = url;
        setPreviewUrl(url);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Náhled selhal.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [pdfUrl, pageNumber, compact]);

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center rounded border bg-muted/30 p-6", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !previewUrl) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {error ?? "Náhled stránky není k dispozici."}
      </p>
    );
  }

  return (
    <>
      <div className={cn("relative group", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={alt}
          className="w-full rounded border bg-white object-contain max-h-56 sm:max-h-72"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute right-2 top-2 opacity-90"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="h-3.5 w-3.5 mr-1" />
          Zvětšit
        </Button>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{alt}</DialogTitle>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={alt} className="w-full rounded border bg-white object-contain max-h-[75vh]" />
        </DialogContent>
      </Dialog>
    </>
  );
}
