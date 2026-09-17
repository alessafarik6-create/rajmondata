"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";
import { cn } from "@/lib/utils";

type Props = {
  fileUrl: string | null | undefined;
  mimeType: string | null | undefined;
  title: string;
  className?: string;
  eager?: boolean;
};

export function SearchResultFileThumbnail({
  fileUrl,
  mimeType,
  title,
  className,
  eager,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!!eager);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const isPdf =
    mimeType?.includes("pdf") || title.toLowerCase().endsWith(".pdf");
  const isImage =
    mimeType?.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(title);

  useEffect(() => {
    if (eager) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "80px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!visible || !fileUrl || failed) return;
    let revoked: string | null = null;
    let cancelled = false;

    async function load() {
      if (isImage) {
        setThumbUrl(fileUrl!);
        return;
      }
      if (!isPdf) return;
      setLoading(true);
      try {
        const blobs = await renderPdfPagesToPngBlobs(fileUrl!, [1], 0.85);
        if (cancelled || !blobs[0]) {
          setFailed(true);
          return;
        }
        const url = URL.createObjectURL(blobs[0]);
        revoked = url;
        setThumbUrl(url);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [visible, fileUrl, isImage, isPdf, failed]);

  const icon = isImage ? (
    <ImageIcon className="h-6 w-6 text-muted-foreground" />
  ) : (
    <FileText className="h-6 w-6 text-muted-foreground" />
  );

  return (
    <div
      ref={ref}
      className={cn(
        "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40",
        className
      )}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        icon
      )}
    </div>
  );
}
