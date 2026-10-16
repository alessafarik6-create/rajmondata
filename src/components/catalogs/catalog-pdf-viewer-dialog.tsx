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
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fileUrl: string;
  fileName?: string;
};

/** Načte PDF z URL (Storage) a zobrazí v integrovaném prohlížeči se stránkováním a zoomem. */
export function CatalogPdfViewerDialog({ open, onOpenChange, title, fileUrl, fileName }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !fileUrl.trim()) {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setError(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`Soubor se nepodařilo načíst (HTTP ${res.status}).`);
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "PDF se nepodařilo načíst.");
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
  }, [open, fileUrl]);

  const safeName = (fileName || title || "dokument.pdf").replace(/[\\/]/g, "-");

  if (error && open && !blobUrl && !loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{error}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Zavřít
            </Button>
            <Button type="button" asChild>
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Otevřít v novém okně
              </a>
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
      onDownload={() => {
        const a = document.createElement("a");
        a.href = fileUrl;
        a.download = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      }}
    />
  );
}
