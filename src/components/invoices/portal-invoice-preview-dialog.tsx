"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PortalInvoicePreviewViewer } from "@/components/invoices/portal-invoice-preview-viewer";
import { cn } from "@/lib/utils";
import type { User } from "firebase/auth";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  title: string;
  user?: User | null;
  onSendEmail?: () => void;
  showSendEmail?: boolean;
  onDownloadPdf?: (args: { html: string; title: string }) => Promise<void>;
};

export function PortalInvoicePreviewDialog({
  open,
  onOpenChange,
  html,
  title,
  user,
  onSendEmail,
  showSendEmail = false,
  onDownloadPdf,
}: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!open) {
      setFullscreen(false);
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
      setFullscreen(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-neutral-950/90"
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          "[&>button.absolute]:hidden",
          fullscreen
            ? "!fixed !inset-0 !left-0 !top-0 !h-[100dvh] !w-screen !max-h-none !max-w-none !translate-x-0 !translate-y-0 !rounded-none"
            : "!left-1/2 !top-1/2 !h-[90vh] !max-h-[90vh] !w-[min(76vw,1180px)] !max-w-[min(76vw,1180px)] -translate-x-1/2 -translate-y-1/2 !rounded-lg"
        )}
      >
        <PortalInvoicePreviewViewer
          html={html}
          title={title}
          user={user}
          layout={fullscreen ? "fullscreen" : "compact"}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
          showFullscreenToggle
          onClose={() => onOpenChange(false)}
          onSendEmail={onSendEmail}
          showSendEmail={showSendEmail}
          onDownloadPdf={onDownloadPdf}
          className="h-full min-h-0"
        />
      </DialogContent>
    </Dialog>
  );
}
