"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Download,
  Printer,
  Mail,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  INVOICE_A4_WIDTH_PX,
  INVOICE_PREVIEW_DEFAULT_ZOOM_COMPACT,
  INVOICE_PREVIEW_ZOOM_LEVELS,
  prepareInvoicePreviewHtmlForViewer,
  type InvoicePreviewZoomLevel,
} from "@/lib/invoice-a4-html";
import { printInvoiceHtmlDocument } from "@/lib/print-html";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { User } from "firebase/auth";

const ZOOM_FIT = "fit" as const;

function clampZoomPercent(value: number): InvoicePreviewZoomLevel {
  const clamped = Math.min(150, Math.max(50, Math.round(value)));
  const nearest = INVOICE_PREVIEW_ZOOM_LEVELS.reduce((prev, cur) =>
    Math.abs(cur - clamped) < Math.abs(prev - clamped) ? cur : prev
  );
  return nearest;
}

/** Přizpůsobení bez useknutí do stran; u dlouhého dokladu jen podle šířky (scroll dolů). */
function computeFitZoomPercent(
  availableWidth: number,
  availableHeight: number,
  contentHeight: number
): InvoicePreviewZoomLevel {
  const padding = 16;
  const w = Math.max(160, availableWidth - padding);
  const h = Math.max(160, availableHeight - padding);
  const widthZoom = (w / INVOICE_A4_WIDTH_PX) * 100;
  const heightZoom = (h / Math.max(contentHeight, 1)) * 100;
  const useHeight =
    contentHeight > 0 && contentHeight <= h * 1.05 && heightZoom < widthZoom;
  return clampZoomPercent(useHeight ? heightZoom : widthZoom);
}

function measureIframeContentHeight(iframe: HTMLIFrameElement): number {
  const doc = iframe.contentDocument;
  if (!doc) return 0;
  const el = doc.documentElement;
  const body = doc.body;
  return Math.max(
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    el?.scrollHeight ?? 0,
    el?.offsetHeight ?? 0
  );
}

export type PortalInvoicePreviewLayout = "compact" | "fullscreen" | "embedded";

export type PortalInvoicePreviewViewerProps = {
  html: string;
  title: string;
  user?: User | null;
  className?: string;
  onClose?: () => void;
  onSendEmail?: () => void;
  showSendEmail?: boolean;
  /** Kompaktní modal (~76 % šířky, max 1180 px) vs. celá obrazovka. */
  layout?: PortalInvoicePreviewLayout;
  fullscreen?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  showFullscreenToggle?: boolean;
  /** Vlastní stažení PDF (např. report nákladů zakázky). */
  onDownloadPdf?: (args: { html: string; title: string }) => Promise<void>;
};

export function PortalInvoicePreviewViewer({
  html,
  title,
  user,
  className,
  onClose,
  onSendEmail,
  showSendEmail = false,
  layout = "compact",
  fullscreen = false,
  onFullscreenChange,
  showFullscreenToggle = true,
  onDownloadPdf,
}: PortalInvoicePreviewViewerProps) {
  const { toast } = useToast();
  const isFullscreenLayout = layout === "fullscreen" || fullscreen;
  const previewHtml = prepareInvoicePreviewHtmlForViewer(html);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">(
    isFullscreenLayout ? "fit" : "manual"
  );
  const [manualZoom, setManualZoom] = useState<InvoicePreviewZoomLevel>(
    isFullscreenLayout ? 100 : INVOICE_PREVIEW_DEFAULT_ZOOM_COMPACT
  );
  const [fitZoom, setFitZoom] = useState<InvoicePreviewZoomLevel>(
    INVOICE_PREVIEW_DEFAULT_ZOOM_COMPACT
  );
  const [contentHeight, setContentHeight] = useState(1123);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const syncIframeHeight = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const h = measureIframeContentHeight(iframe);
    if (h > 0) setContentHeight(h);
  }, []);

  useEffect(() => {
    if (!previewHtml) {
      setIframeSrc(null);
      return () => {
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }
    try {
      const blob = new Blob([previewHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setIframeSrc(url);
    } catch {
      setIframeSrc(null);
    }
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [previewHtml]);

  const computeFitZoom = useCallback((): InvoicePreviewZoomLevel => {
    const el = scrollRef.current;
    if (!el) return INVOICE_PREVIEW_DEFAULT_ZOOM_COMPACT;
    return computeFitZoomPercent(el.clientWidth, el.clientHeight, contentHeight);
  }, [contentHeight]);

  useEffect(() => {
    if (isFullscreenLayout) {
      setZoomMode("fit");
    } else {
      setZoomMode("manual");
      setManualZoom(INVOICE_PREVIEW_DEFAULT_ZOOM_COMPACT);
    }
  }, [isFullscreenLayout]);

  useEffect(() => {
    if (zoomMode !== "fit") return;
    setFitZoom(computeFitZoom());
  }, [zoomMode, computeFitZoom, isFullscreenLayout, iframeSrc, contentHeight]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || zoomMode !== "fit") return;
    const ro = new ResizeObserver(() => setFitZoom(computeFitZoom()));
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomMode, computeFitZoom]);

  const zoomPercent = zoomMode === "fit" ? fitZoom : manualZoom;
  const scale = zoomPercent / 100;
  const scaledWidth = INVOICE_A4_WIDTH_PX * scale;
  const scaledHeight = contentHeight * scale;

  const handlePrint = () => {
    const result = printInvoiceHtmlDocument(html, title);
    if (result === "blocked") {
      toast({
        variant: "destructive",
        title: "Tisk byl zablokován",
        description: "Povolte vyskakovací okna pro tento web.",
      });
    }
  };

  const handleDownloadPdf = async () => {
    if (onDownloadPdf) {
      setPdfBusy(true);
      try {
        await onDownloadPdf({ html, title });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Export PDF",
          description: e instanceof Error ? e.message : "Zkuste tisk → Uložit jako PDF.",
        });
        handlePrint();
      } finally {
        setPdfBusy(false);
      }
      return;
    }
    if (!user) {
      handlePrint();
      return;
    }
    setPdfBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/portal-invoices/render-pdf", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html: previewHtml, filename: `${title}.pdf` }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "PDF se nepodařilo vygenerovat.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^\w.-]+/g, "_") || "faktura"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Export PDF",
        description: e instanceof Error ? e.message : "Zkuste tisk → Uložit jako PDF.",
      });
      handlePrint();
    } finally {
      setPdfBusy(false);
    }
  };

  const zoomSelectValue = zoomMode === "fit" ? ZOOM_FIT : String(manualZoom);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        className={cn(
          "sticky top-0 z-20 shrink-0 border-b border-neutral-800 bg-neutral-950 text-neutral-100",
          "px-2 py-2 sm:px-4"
        )}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 truncate text-sm font-medium sm:flex-1 sm:text-base">
            Náhled — {title}
          </p>
          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 sm:flex-wrap sm:justify-end sm:gap-2 sm:overflow-visible">
            <Select
              value={zoomSelectValue}
              onValueChange={(v) => {
                if (v === ZOOM_FIT) {
                  setZoomMode("fit");
                  setFitZoom(computeFitZoom());
                } else {
                  setZoomMode("manual");
                  setManualZoom(Number(v) as InvoicePreviewZoomLevel);
                }
              }}
            >
              <SelectTrigger
                className="h-9 w-[7.5rem] shrink-0 border-neutral-600 bg-neutral-900 text-neutral-100 sm:w-32"
                aria-label="Zoom"
              >
                <SelectValue placeholder="Zoom" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ZOOM_FIT}>Přizpůsobit</SelectItem>
                {INVOICE_PREVIEW_ZOOM_LEVELS.map((level) => (
                  <SelectItem key={level} value={String(level)}>
                    {level} %
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5 border-neutral-600 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
              onClick={handlePrint}
              disabled={!html}
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Tisk</span>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              onClick={() => void handleDownloadPdf()}
              disabled={!html || pdfBusy}
            >
              {pdfBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Stáhnout PDF</span>
            </Button>
            {showSendEmail && onSendEmail ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5 border-neutral-600 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                onClick={onSendEmail}
              >
                <Mail className="h-4 w-4" />
                <span className="hidden sm:inline">Odeslat e-mailem</span>
              </Button>
            ) : null}
            {showFullscreenToggle && onFullscreenChange ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5 border-neutral-600 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                onClick={() => onFullscreenChange(!fullscreen)}
              >
                {fullscreen ? (
                  <>
                    <Minimize2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Zmenšit</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Otevřít na celou obrazovku</span>
                  </>
                )}
              </Button>
            ) : null}
            {onClose ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1.5 border-neutral-600 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Zavřít</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-neutral-900"
      >
        {iframeSrc ? (
          <div className="flex w-full justify-center py-4 sm:py-6">
            <div
              className="relative shrink-0"
              style={{ width: scaledWidth, height: scaledHeight }}
            >
              <div
                className="absolute left-0 top-0"
                style={{
                  width: INVOICE_A4_WIDTH_PX,
                  height: contentHeight,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              >
                <iframe
                  ref={iframeRef}
                  title={title}
                  src={iframeSrc}
                  referrerPolicy="no-referrer"
                  scrolling="no"
                  onLoad={() => {
                    syncIframeHeight();
                    requestAnimationFrame(syncIframeHeight);
                  }}
                  className="block border-0 bg-white shadow-xl"
                  style={{
                    width: INVOICE_A4_WIDTH_PX,
                    height: contentHeight,
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center p-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
