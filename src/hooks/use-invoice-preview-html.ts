"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import { resolveInvoiceDisplayHtml } from "@/lib/invoice-html-rebuild";
import { INVOICE_PDF_TEMPLATE_VERSION, isInvoicePdfTemplateOutdated } from "@/lib/invoice-pdf-template";

export type InvoicePreviewHtmlState = {
  html: string;
  loading: boolean;
  error: string | null;
  source: string;
  templateVersion: number;
  outdated: boolean;
  hasOriginalArchive: boolean;
  refreshPreview: () => Promise<void>;
  persistPreview: () => Promise<boolean>;
};

export function useInvoicePreviewHtml(params: {
  user: User | null | undefined;
  invoiceId: string;
  invoice: Record<string, unknown> | null | undefined;
  companyDoc: Record<string, unknown> | null | undefined;
  orgBankAccounts: OrgBankAccountRow[];
}): InvoicePreviewHtmlState {
  const { user, invoiceId, invoice, companyDoc, orgBankAccounts } = params;
  const [serverHtml, setServerHtml] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    source: string;
    templateVersion: number;
    hasOriginalArchive: boolean;
    outdated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientFallback = useMemo(() => {
    if (!invoice) return { html: "", source: "original", templateVersion: 0, hasOriginalArchive: false };
    return resolveInvoiceDisplayHtml({
      invoiceDoc: invoice,
      companyDoc: companyDoc ?? undefined,
      orgBankAccounts,
    });
  }, [invoice, companyDoc, orgBankAccounts]);

  const loadFromApi = useCallback(async () => {
    if (!user || !invoiceId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/portal-invoices/${encodeURIComponent(invoiceId)}/preview-html`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        html?: string;
        source?: string;
        templateVersion?: number;
        hasOriginalArchive?: boolean;
        outdated?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.html) {
        throw new Error(j.error || "Náhled se nepodařilo načíst.");
      }
      setServerHtml(j.html);
      setMeta({
        source: j.source ?? "rebuilt",
        templateVersion: j.templateVersion ?? INVOICE_PDF_TEMPLATE_VERSION,
        hasOriginalArchive: Boolean(j.hasOriginalArchive),
        outdated: Boolean(j.outdated),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba náhledu.");
      setServerHtml(null);
    } finally {
      setLoading(false);
    }
  }, [user, invoiceId]);

  useEffect(() => {
    void loadFromApi();
  }, [loadFromApi]);

  const persistPreview = useCallback(async (): Promise<boolean> => {
    if (!user || !invoiceId) return false;
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/portal-invoices/${encodeURIComponent(invoiceId)}/refresh-pdf-preview`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; html?: string; error?: string };
      if (!res.ok || !j.ok || !j.html) {
        throw new Error(j.error || "Uložení náhledu selhalo.");
      }
      setServerHtml(j.html);
      setMeta((prev) => ({
        source: "preview_cache",
        templateVersion: INVOICE_PDF_TEMPLATE_VERSION,
        hasOriginalArchive: true,
        outdated: false,
        ...(prev ?? {}),
      }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uložení náhledu selhalo.");
      return false;
    }
  }, [user, invoiceId]);

  const html = serverHtml?.trim() || clientFallback.html;
  const outdated =
    meta?.outdated ??
    (invoice ? isInvoicePdfTemplateOutdated(invoice, String(invoice.pdfHtml ?? "")) : false);

  return {
    html,
    loading,
    error,
    source: meta?.source ?? clientFallback.source,
    templateVersion: meta?.templateVersion ?? clientFallback.templateVersion,
    outdated,
    hasOriginalArchive:
      (meta?.hasOriginalArchive ?? clientFallback.hasOriginalArchive) ||
      Boolean(invoice?.pdfHtmlArchive),
    refreshPreview: loadFromApi,
    persistPreview,
  };
}
