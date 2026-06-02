"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Printer } from "lucide-react";
import { sanitizeInvoicePreviewHtml } from "@/lib/invoice-a4-html";
import { printInvoiceHtmlDocument } from "@/lib/print-html";
import { useToast } from "@/hooks/use-toast";
import type { User } from "firebase/auth";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  title: string;
  user?: User | null;
};

export function PortalInvoicePreviewDialog({ open, onOpenChange, html, title, user }: Props) {
  const { toast } = useToast();
  const previewHtml = sanitizeInvoicePreviewHtml(html);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!open || !previewHtml) {
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
  }, [open, previewHtml]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] max-w-[min(96vw,900px)] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>Náhled faktury — {title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-2 sm:p-4">
          {iframeSrc ? (
            <iframe
              title={title}
              src={iframeSrc}
              className="mx-auto block min-h-[70vh] w-full max-w-[210mm] border-0 bg-white shadow-md"
            />
          ) : (
            <div className="flex justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t px-4 py-3 sm:justify-end">
          <Button type="button" variant="outline" className="gap-2" onClick={handlePrint} disabled={!html}>
            <Printer className="h-4 w-4" />
            Tisk
          </Button>
          <Button type="button" className="gap-2" onClick={() => void handleDownloadPdf()} disabled={!html || pdfBusy}>
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Stáhnout PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
