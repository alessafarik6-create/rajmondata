"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";
import { cn } from "@/lib/utils";

type Props = {
  pdfUrl: string | null | undefined;
  className?: string;
};

export function JobMediaPdfThumbnailPreview({ pdfUrl, className }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pdfUrl?.trim()) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    let revoked: string | null = null;
    void (async () => {
      try {
        const blobs = await renderPdfPagesToPngBlobs(pdfUrl, [1], 1.15);
        if (cancelled) return;
        const url = URL.createObjectURL(blobs[0]!);
        revoked = url;
        setThumbUrl(url);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [pdfUrl]);

  if (thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbUrl}
        alt=""
        className={cn("aspect-[4/3] min-h-[240px] w-full object-cover object-top bg-white", className)}
      />
    );
  }

  if (!failed && pdfUrl) {
    return (
      <div
        className={cn(
          "flex aspect-[4/3] min-h-[240px] w-full items-center justify-center bg-red-500/[0.07]",
          className
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex aspect-[4/3] min-h-[240px] w-full flex-col items-center justify-center gap-2 bg-red-500/[0.07]",
        className
      )}
      aria-hidden
    >
      <FileText className="h-11 w-11 text-red-600 dark:text-red-400" strokeWidth={1.5} />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">PDF</span>
    </div>
  );
}
