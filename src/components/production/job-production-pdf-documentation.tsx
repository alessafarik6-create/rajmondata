"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, ExternalLink } from "lucide-react";

export type JobProductionPdfRow = {
  id: string;
  fileUrl: string;
  fileName: string;
  folderName?: string;
};

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  const ver = pdfjs.version || "4.10.38";
  const major = Number(String(ver).split(".")[0] || "4");
  pdfjs.GlobalWorkerOptions.workerSrc =
    major === 3
      ? "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
      : `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

/**
 * Velký náhled PDF u výdeje materiálu ve výrobě — listování stránek a zoom v jednom okně (stav React).
 */
export function JobProductionPdfDocumentationPanel({
  pdfFiles,
  attachmentsLoading,
}: {
  pdfFiles: JobProductionPdfRow[];
  attachmentsLoading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  /** Násobek škálování „vejde se na šířku“ (1 = přizpůsobit šířce). */
  const [zoomMul, setZoomMul] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [docLoading, setDocLoading] = useState(false);
  const [pageRendering, setPageRendering] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const safeIndex = pdfFiles.length > 0 ? Math.min(Math.max(0, selectedIndex), pdfFiles.length - 1) : 0;
  const current = pdfFiles.length > 0 ? pdfFiles[safeIndex] : null;

  useEffect(() => {
    if (pdfFiles.length === 0) return;
    setSelectedIndex((i) => Math.min(Math.max(0, i), pdfFiles.length - 1));
  }, [pdfFiles.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const openUrl = current?.fileUrl || "";

  // Načtení dokumentu při změně souboru
  useEffect(() => {
    if (!current?.fileUrl) {
      setNumPages(0);
      setPage(1);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setDocLoading(true);
      setLoadError(null);
      setNumPages(0);
      try {
        try {
          pdfRef.current?.destroy?.();
        } catch {
          /* */
        }
        pdfRef.current = null;

        const pdfjs = await loadPdfJs();
        const url = String(current.fileUrl).trim();
        if (!url) throw new Error("Chybí URL souboru.");

        let task = pdfjs.getDocument({
          url,
          withCredentials: false,
          disableRange: true,
          disableStream: true,
        });

        let pdf: PDFDocumentProxy;
        try {
          pdf = await task.promise;
        } catch (firstErr) {
          // Zkusit stáhnout jako blob (někdy pomůže u Storage / CORS).
          const res = await fetch(url, { mode: "cors", credentials: "omit" });
          if (!res.ok) throw firstErr;
          const buf = await res.arrayBuffer();
          task = pdfjs.getDocument({ data: new Uint8Array(buf), disableRange: true, disableStream: true });
          pdf = await task.promise;
        }

        if (cancelled) {
          try {
            pdf.destroy?.();
          } catch {
            /* */
          }
          return;
        }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages || 0);
        setPage(1);
      } catch (e) {
        console.error("[JobProductionPdfDocumentationPanel] load PDF", e);
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "PDF se nepodařilo načíst.");
          setNumPages(0);
        }
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        pdfRef.current?.destroy?.();
      } catch {
        /* */
      }
      pdfRef.current = null;
    };
  }, [current?.fileUrl, current?.id]);

  const renderPage = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const cw = containerWidth;
    if (!pdf || !canvas || numPages < 1 || page < 1 || page > numPages || cw < 40) return;

    setPageRendering(true);
    try {
      const p = await pdf.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const maxCssH = Math.min(1000, typeof window !== "undefined" ? window.innerHeight * 0.85 : 900);
      const fitW = (cw - 16) / base.width;
      const fitH = maxCssH / base.height;
      const fit = Math.min(fitW, fitH, 3);
      const scale = Math.max(0.15, Math.min(4, fit * zoomMul));
      const vp = p.getViewport({ scale });
      const w = Math.round(vp.width);
      const h = Math.round(vp.height);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, w, h);
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.maxHeight = `${maxCssH}px`;
      setLoadError(null);
    } catch (e) {
      console.error("[JobProductionPdfDocumentationPanel] render page", e);
      setLoadError(e instanceof Error ? e.message : "Chyba vykreslení stránky.");
    } finally {
      setPageRendering(false);
    }
  }, [containerWidth, numPages, page, zoomMul]);

  useEffect(() => {
    void renderPage();
  }, [renderPage]);

  const busy = attachmentsLoading || docLoading;

  const titleExtra = useMemo(() => {
    if (!current?.folderName) return "";
    return ` · ${current.folderName}`;
  }, [current?.folderName]);

  if (attachmentsLoading && pdfFiles.length === 0) {
    return (
      <section
        aria-labelledby="job-production-pdf-doc"
        className="space-y-4 border-t-2 border-slate-200/90 pt-10 sm:pt-12"
      >
        <h3
          id="job-production-pdf-doc"
          className="border-b border-slate-200 pb-3 text-base font-semibold text-slate-900"
        >
          PDF dokumentace zakázky
        </h3>
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-slate-500" aria-label="Načítání podkladů" />
        </div>
      </section>
    );
  }

  if (pdfFiles.length === 0) {
    return (
      <section
        aria-labelledby="job-production-pdf-doc"
        className="space-y-3 border-t-2 border-slate-200/90 pt-10 sm:pt-12"
      >
        <h3
          id="job-production-pdf-doc"
          className="border-b border-slate-200 pb-3 text-base font-semibold text-slate-900"
        >
          PDF dokumentace zakázky
        </h3>
        <p className="text-sm text-slate-600">
          U této zakázky nejsou ve výrobních podkladech žádná PDF (nebo k nim nemáte přístup). Nahrajte PDF do
          složky zakázky označené pro výrobu.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="job-production-pdf-doc"
      className="space-y-5 border-t-2 border-slate-200/90 pt-10 sm:pt-12"
    >
      <h3
        id="job-production-pdf-doc"
        className="border-b border-slate-200 pb-3 text-base font-semibold text-slate-900"
      >
        PDF dokumentace zakázky
      </h3>
      <p className="text-xs text-slate-600">
        Náhled podle oprávnění složek zakázky. Listování stránek a zoom nemění výběr materiálu výše.
      </p>

      {pdfFiles.length > 1 ? (
        <div className="space-y-2 max-w-xl">
          <Label className="text-sm font-semibold text-slate-800">Vybrat PDF</Label>
          <Select
            value={String(safeIndex)}
            onValueChange={(v) => {
              setSelectedIndex(Number(v));
              setPage(1);
              setZoomMul(1);
              setLoadError(null);
            }}
          >
            <SelectTrigger className="border-slate-300 bg-white text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200 max-h-[min(24rem,70vh)]">
              {pdfFiles.map((f, i) => (
                <SelectItem key={f.id} value={String(i)} className="py-2">
                  <span className="line-clamp-2">{f.fileName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-slate-900 line-clamp-2 min-w-0 flex-1" title={current?.fileName}>
            {current?.fileName}
            {titleExtra}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                disabled={busy || page <= 1 || numPages < 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Předchozí stránka"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular-nums px-2 text-sm text-slate-700">
                {numPages > 0 ? (
                  <>
                    {page} / {numPages}
                  </>
                ) : (
                  "—"
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                disabled={busy || numPages < 1 || page >= numPages}
                onClick={() => setPage((p) => Math.min(numPages, p + 1))}
                aria-label="Další stránka"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                disabled={busy}
                onClick={() => setZoomMul((z) => Math.max(0.25, z / 1.2))}
                aria-label="Zmenšit"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                disabled={busy}
                onClick={() => setZoomMul((z) => Math.min(4, z * 1.2))}
                aria-label="Zvětšit"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1 px-2"
                disabled={busy}
                onClick={() => setZoomMul(1)}
                aria-label="Přizpůsobit šířce"
              >
                <Maximize2 className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">Šířka</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full max-h-[min(1000px,90vh)] overflow-auto rounded-xl border-2 border-slate-200 bg-slate-100/90 shadow-inner"
      >
        {(busy || pageRendering) && !loadError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
            <Loader2 className="h-10 w-10 animate-spin text-slate-600" aria-label="Načítání PDF" />
          </div>
        ) : null}
        <div className="flex min-h-[min(420px,50vh)] w-full justify-center p-2 sm:p-3">
          {loadError ? (
            <div className="flex max-w-lg flex-col items-center justify-center gap-4 px-4 py-12 text-center">
              <p className="text-sm text-slate-700">V prohlížeči se PDF nepodařilo zobrazit ({loadError}).</p>
              {openUrl ? (
                <Button type="button" variant="outline" className="gap-2 bg-white" asChild>
                  <a href={openUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Otevřít PDF v nové záložce
                  </a>
                </Button>
              ) : null}
            </div>
          ) : (
            <canvas ref={canvasRef} className="block w-full max-w-full bg-white shadow-md" />
          )}
        </div>
      </div>
    </section>
  );
}
