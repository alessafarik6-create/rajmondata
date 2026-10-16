"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";
import { renderPdfFirstPageThumbnailFromData } from "@/lib/pdf-to-image-client";
import {
  catalogPdfCacheKey,
  CatalogPdfLoadError,
  loadCatalogPdfBytes,
} from "@/lib/product-catalog-pdf-client";
import { cn } from "@/lib/utils";

const thumbObjectUrlCache = new Map<string, string>();

type Props = {
  attachment: ProductCatalogPdfAttachment;
  /** Okamžitý náhled po nahrání (z lokálního File). */
  instantObjectUrl?: string | null;
  onClick?: () => void;
  className?: string;
};

export function CatalogPdfThumbnail({ attachment, instantObjectUrl, onClick, className }: Props) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => {
    const key = catalogPdfCacheKey(attachment);
    return thumbObjectUrlCache.get(key) ?? instantObjectUrl ?? null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (instantObjectUrl) {
      setThumbUrl(instantObjectUrl);
    }
  }, [instantObjectUrl]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "120px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const attachmentKey = catalogPdfCacheKey(attachment);

  useEffect(() => {
    if (!visible || thumbUrl || instantObjectUrl) return;
    const key = attachmentKey;
    const cached = thumbObjectUrlCache.get(key);
    if (cached) {
      setThumbUrl(cached);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { data } = await loadCatalogPdfBytes(attachment);
        const png = await renderPdfFirstPageThumbnailFromData(data, 160);
        if (cancelled) return;
        created = URL.createObjectURL(png);
        thumbObjectUrlCache.set(key, created);
        setThumbUrl(created);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof CatalogPdfLoadError ? e.message : "Náhled nelze vytvořit.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (created && !thumbObjectUrlCache.has(key)) URL.revokeObjectURL(created);
    };
  }, [visible, attachmentKey, thumbUrl, instantObjectUrl]);

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "relative flex h-[7.5rem] w-[5.5rem] shrink-0 flex-col overflow-hidden rounded-md border bg-white shadow-sm transition hover:ring-2 hover:ring-orange-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
        !onClick && "cursor-default",
        className
      )}
      title={error ?? (attachment.displayName || attachment.fileName)}
    >
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt=""
          className="h-full w-full object-contain object-center bg-white"
        />
      ) : loading ? (
        <span className="flex h-full w-full items-center justify-center bg-muted/40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </span>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-red-50 px-1 text-center">
          <FileText className="h-8 w-8 text-red-600" aria-hidden />
          <span className="text-[10px] leading-tight text-red-800/80">
            {error ? "Náhled selhal" : "PDF"}
          </span>
        </span>
      )}
    </button>
  );
}

/** Náhled první stránky z právě nahraného souboru (bez Storage). */
export async function createInstantPdfThumbnailFromFile(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const png = await renderPdfFirstPageThumbnailFromData(data, 160);
  return URL.createObjectURL(png);
}
