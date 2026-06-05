"use client";

import React, { useCallback } from "react";
import { PortalInvoicePreviewDialog } from "@/components/invoices/portal-invoice-preview-dialog";
import { downloadJobExpensesReportPdf } from "@/lib/job-expenses-pdf-client";
import type { User } from "firebase/auth";

export function JobExpensesPdfPreviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  title: string;
  user?: User | null;
  companyId: string;
  jobId: string;
  pdfFilename?: string;
  onExported?: () => void;
}) {
  const {
    open,
    onOpenChange,
    html,
    title,
    user,
    companyId,
    jobId,
    pdfFilename,
    onExported,
  } = props;

  const handleDownloadPdf = useCallback(
    async ({ html: docHtml, title: docTitle }: { html: string; title: string }) => {
      if (!user) throw new Error("Pro stažení PDF se přihlaste.");
      const blob = await downloadJobExpensesReportPdf({
        user,
        companyId,
        jobId,
        html: docHtml,
        filename: pdfFilename ?? `${docTitle}.pdf`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (pdfFilename ?? `${docTitle}.pdf`).replace(/[^\w.-]+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      onExported?.();
    },
    [user, companyId, jobId, pdfFilename, onExported]
  );

  if (!open || !html.trim()) return null;

  return (
    <PortalInvoicePreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      html={html}
      title={title}
      user={user}
      onDownloadPdf={handleDownloadPdf}
    />
  );
}
