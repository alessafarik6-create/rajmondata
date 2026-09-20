"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getPdfPageCountFromUrl, renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pdfBlobUrl: string | null;
  onDownload?: () => void;
};

export function EmailPdfViewerDialog(props: Props) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open || !props.pdfBlobUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const n = await getPdfPageCountFromUrl(props.pdfBlobUrl!);
        if (!cancelled) {
          setPageCount(Math.max(1, n));
          setPage(1);
        }
      } catch {
        if (!cancelled) setPageCount(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open, props.pdfBlobUrl]);

  const renderPage = useCallback(async () => {
    if (!props.pdfBlobUrl) return;
    setLoading(true);
    setError(null);
    let revoked: string | null = null;
    try {
      const blobs = await renderPdfPagesToPngBlobs(props.pdfBlobUrl, [page], scale);
      const url = URL.createObjectURL(blobs[0]!);
      revoked = url;
      setImgUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nelze zobrazit PDF.");
    } finally {
      setLoading(false);
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [props.pdfBlobUrl, page, scale]);

  useEffect(() => {
    if (!props.open || !props.pdfBlobUrl) return;
    void renderPage();
  }, [props.open, props.pdfBlobUrl, renderPage]);

  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  useEffect(() => {
    if (!props.open) {
      setImgUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPage(1);
      setError(null);
    }
  }, [props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{props.title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto rounded border bg-muted/20 p-2">
          {loading ? (
            <div className="flex h-[50vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{error}</p>
          ) : imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="" className="mx-auto max-w-full object-contain" />
          ) : null}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-1">
              {page} / {pageCount}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setScale((s) => Math.max(0.8, s - 0.2))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          {props.onDownload ? (
            <Button type="button" size="sm" variant="secondary" onClick={props.onDownload}>
              <Download className="h-4 w-4 mr-1" /> Stáhnout
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
