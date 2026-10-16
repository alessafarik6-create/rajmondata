"use client";

import React, { useEffect, useState } from "react";
import { EmailPdfViewerDialog } from "@/components/portal/email-pdf-viewer-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import type { ProductCatalogPdfAttachment } from "@/lib/product-catalogs";
import {
  CatalogPdfLoadError,
  createCatalogPdfBlobUrl,
  loadCatalogPdfBytes,
} from "@/lib/product-catalog-pdf-client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  attachment: Pick<ProductCatalogPdfAttachment, "storagePath" | "downloadUrl" | "fileName">;
  fileName?: string;
};

/** Načte PDF přes Storage SDK a zobrazí v integrovaném prohlížeči (pdf.js). */
export function CatalogPdfViewerDialog({
  open,
  onOpenChange,
  title,
  attachment,
  fileName,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [downloadHref, setDownloadHref] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setDownloadHref("");
      setError(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const url = await createCatalogPdfBlobUrl(attachment);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setBlobUrl(url);
        setDownloadHref(
          typeof attachment.downloadUrl === "string" && attachment.downloadUrl.trim()
            ? attachment.downloadUrl.trim()
            : url
        );
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof CatalogPdfLoadError
              ? e.message
              : e instanceof Error
                ? e.message
                : "PDF se nepodařilo načíst."
          );
          setBlobUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, attachment]);

  const safeName = (fileName || attachment.fileName || title || "dokument.pdf").replace(
    /[\\/]/g,
    "-"
  );

  const triggerDownload = async () => {
    try {
      if (downloadHref.startsWith("http")) {
        const a = document.createElement("a");
        a.href = downloadHref;
        a.download = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
        return;
      }
      const { data } = await loadCatalogPdfBytes(attachment);
      const blob = new Blob([data], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stažení selhalo.");
    }
  };

  if (error && open && !blobUrl && !loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-xs text-muted-foreground">
            Zkontrolujte oprávnění ve Storage a že soubor existuje na cestě uvedené v metadatech
            katalogu.
          </p>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Zavřít
            </Button>
            <Button type="button" variant="default" onClick={() => void triggerDownload()}>
              <Download className="mr-2 h-4 w-4" />
              Zkusit stáhnout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (loading && open && !blobUrl) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Načítám PDF…</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <EmailPdfViewerDialog
      open={open && !!blobUrl}
      onOpenChange={onOpenChange}
      title={title}
      pdfBlobUrl={blobUrl}
      onDownload={() => void triggerDownload()}
    />
  );
}
