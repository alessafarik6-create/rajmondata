"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { collection, doc, query, where, orderBy } from "firebase/firestore";
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, Printer, Download, Pencil, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import {
  PORTAL_MANUAL_INVOICE_TYPE,
  parseInvoiceRecipientFromInvoiceDoc,
} from "@/lib/portal-manual-invoice";
import { printInvoiceHtmlDocument } from "@/lib/print-html";
import { useToast } from "@/hooks/use-toast";
import { PortalInvoiceSendDialog } from "@/components/invoices/portal-invoice-send-dialog";
import { PortalInvoicePreviewViewer } from "@/components/invoices/portal-invoice-preview-viewer";
import { PortalInvoicePreviewDialog } from "@/components/invoices/portal-invoice-preview-dialog";
import { formatCsDateTimeDot } from "@/lib/date-safe";

export default function InvoiceDocumentPage() {
  const params = useParams();
  const invoiceId = typeof params?.invoiceId === "string" ? params.invoiceId : "";
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const invoiceRef = useMemoFirebase(
    () =>
      firestore && companyId && invoiceId
        ? doc(firestore, "companies", companyId, "invoices", invoiceId)
        : null,
    [firestore, companyId, invoiceId]
  );
  const {
    data: invoice,
    isLoading: invoiceLoading,
    error: invoiceError,
    isIndexPending,
  } = useDoc(invoiceRef);

  const deliveryNotesQuery = useMemoFirebase(
    () =>
      firestore && companyId && invoiceId
        ? query(
            collection(firestore, "companies", companyId, "documents"),
            where("documentType", "==", "delivery_note"),
            where("invoiceId", "==", invoiceId)
          )
        : null,
    [firestore, companyId, invoiceId]
  );
  const { data: deliveryNotes } = useCollection(deliveryNotesQuery);

  const invType = invoice ? String((invoice as { type?: string }).type ?? "") : "";
  const isPortalManual = invType === PORTAL_MANUAL_INVOICE_TYPE;

  const emailHistoryQuery = useMemoFirebase(
    () =>
      firestore && companyId && invoiceId && isPortalManual
        ? query(
            collection(
              firestore,
              "companies",
              companyId,
              "invoices",
              invoiceId,
              "emailOutboundHistory"
            ),
            orderBy("sentAt", "desc")
          )
        : null,
    [firestore, companyId, invoiceId, isPortalManual]
  );
  const { data: emailHistoryRaw } = useCollection(emailHistoryQuery);

  const [sendOpen, setSendOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const html = useMemo(() => {
    const h =
      invoice && typeof (invoice as { pdfHtml?: string }).pdfHtml === "string"
        ? (invoice as { pdfHtml: string }).pdfHtml
        : "";
    return h.trim();
  }, [invoice]);

  const [largePreviewOpen, setLargePreviewOpen] = useState(false);

  const title = useMemo(() => {
    const inv = invoice as { invoiceNumber?: string; documentNumber?: string } | null;
    return String(inv?.invoiceNumber ?? inv?.documentNumber ?? "Doklad");
  }, [invoice]);

  const isAdvance = invType === JOB_INVOICE_TYPES.ADVANCE;
  const isSettlement = invType === JOB_INVOICE_TYPES.FINAL_INVOICE;
  const isTaxReceipt = invType === JOB_INVOICE_TYPES.TAX_RECEIPT;

  const defaultRecipientEmail = useMemo(() => {
    if (!invoice) return "";
    const snap = parseInvoiceRecipientFromInvoiceDoc(invoice as Record<string, unknown>);
    if (snap?.email?.trim()) return snap.email.trim();
    return String((invoice as { customerEmail?: string }).customerEmail ?? "").trim();
  }, [invoice]);

  const emailHistory = useMemo(() => {
    const rows = Array.isArray(emailHistoryRaw) ? emailHistoryRaw : [];
    return rows as Array<Record<string, unknown> & { id: string }>;
  }, [emailHistoryRaw]);

  const handlePrint = () => {
    if (!html) {
      toast({
        variant: "destructive",
        title: "Nelze tisknout",
        description: "Chybí uložený obsah dokladu (pdfHtml).",
      });
      return;
    }
    const result = printInvoiceHtmlDocument(html, title);
    if (result === "empty") {
      toast({
        variant: "destructive",
        title: "Nelze tisknout",
        description: "Obsah dokladu je prázdný.",
      });
      return;
    }
    if (result === "blocked") {
      toast({
        variant: "destructive",
        title: "Tisk byl zablokován",
        description:
          "Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tento web nebo zkuste znovu.",
      });
    }
  };

  const handleDownloadPdf = async () => {
    if (!user || !isPortalManual) {
      handlePrint();
      return;
    }
    setPdfBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/portal-invoices/${encodeURIComponent(invoiceId)}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("PDF se nepodařilo stáhnout.");
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

  if (profileLoading || (companyId && invoiceLoading && !invoiceError)) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>Doklad nelze načíst.</AlertDescription>
      </Alert>
    );
  }

  if (invoiceError && !isIndexPending) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Doklad nelze načíst</AlertTitle>
        <AlertDescription>
          {invoiceError.message || "Zkontrolujte oprávnění nebo síť."}{" "}
          <Link href="/portal/documents?view=issued" className="underline">
            Zpět na doklady
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (isIndexPending) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Index se vytváří</AlertTitle>
        <AlertDescription>
          Firestore dokončuje index — zkuste stránku za chvíli znovu načíst.
        </AlertDescription>
      </Alert>
    );
  }

  if (!invoice) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Doklad nebyl nalezen</AlertTitle>
        <AlertDescription>
          Zkontrolujte odkaz nebo oprávnění.{" "}
          <Link href="/portal/documents?view=issued" className="underline">
            Zpět na doklady
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const isInvoiceDeleted =
    (invoice as { isDeleted?: boolean }).isDeleted === true;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-2 pb-10 sm:px-0">
      {isInvoiceDeleted ? (
        <Alert className="border-amber-300 bg-amber-50 text-neutral-950">
          <AlertTitle>Doklad je v koši</AlertTitle>
          <AlertDescription>
            Tento doklad byl odstraněn z běžných přehledů; záznam a přílohy zůstávají uložené.{" "}
            <Link href="/portal/documents?view=trash" className="font-medium underline">
              Otevřít koš
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/portal/documents?view=issued" aria-label="Zpět na doklady">
            <ChevronLeft className="h-6 w-6" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-neutral-950 sm:text-2xl">{title}</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {isAdvance || isSettlement || isTaxReceipt || isPortalManual ? (
            <Button type="button" variant="outline" className="gap-2 border-neutral-950" asChild>
              <Link href={`/portal/invoices/${invoiceId}/edit`}>
                <Pencil className="h-4 w-4" />
                Upravit doklad
              </Link>
            </Button>
          ) : null}
          {isPortalManual ? (
            <Button type="button" variant="outline" className="gap-2 border-neutral-950" onClick={() => setSendOpen(true)}>
              <Mail className="h-4 w-4" />
              Odeslat e-mailem
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-neutral-950"
            disabled={!html}
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4" />
            Tisk
          </Button>
          <Button type="button" className="gap-2" disabled={!html || pdfBusy} onClick={() => void handleDownloadPdf()}>
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Stáhnout PDF
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-700">
        Náhled odpovídá exportu PDF. U portálových faktur lze stáhnout PDF přímo nebo použít tisk.
      </p>
      {isPortalManual && emailHistory.length > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-neutral-900">Historie odeslání e-mailem</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {emailHistory.map((row) => {
              const sentAt = row.sentAt as { toDate?: () => Date } | undefined;
              const when =
                sentAt && typeof sentAt.toDate === "function"
                  ? formatCsDateTimeDot(sentAt.toDate())
                  : "—";
              const cc = Array.isArray(row.cc) ? (row.cc as string[]).join(", ") : "";
              const bcc = Array.isArray(row.bcc) ? (row.bcc as string[]).join(", ") : "";
              const copies = [cc, bcc].filter(Boolean).join("; ");
              return (
                <li key={row.id} className="rounded border border-neutral-200 px-2 py-1.5">
                  <div className="font-medium">
                    {when} · {String(row.status ?? "")} · {String(row.to ?? "")}
                  </div>
                  <div className="text-xs text-neutral-600">
                    {copies ? `Kopie: ${copies}` : null}
                    {row.pdfFilename ? ` · PDF: ${String(row.pdfFilename)}` : null}
                    {row.sentByEmail ? ` · Odeslal: ${String(row.sentByEmail)}` : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-neutral-900">Přiřazené dodací listy</h2>
        {Array.isArray(deliveryNotes) && deliveryNotes.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {deliveryNotes.map((d) => {
              const row = d as {
                id: string;
                number?: string;
                documentNumber?: string;
                fileUrl?: string | null;
                date?: string | null;
              };
              const label = String(row.number ?? row.documentNumber ?? row.id);
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1">
                  <span>{label} {row.date ? `· ${row.date}` : ""}</span>
                  {row.fileUrl ? (
                    <a
                      href={row.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline"
                    >
                      Otevřít dokument
                    </a>
                  ) : (
                    <span className="text-neutral-500">Bez přílohy</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-neutral-600">Není přiřazeno k faktuře.</p>
        )}
      </div>
      {html ? (
        <>
          <div className="mx-auto flex min-h-[min(85vh,960px)] max-w-[1180px] flex-col overflow-hidden rounded-lg border-2 border-neutral-800">
            <PortalInvoicePreviewViewer
              html={html}
              title={title}
              user={user}
              layout="embedded"
              showSendEmail={isPortalManual}
              onSendEmail={isPortalManual ? () => setSendOpen(true) : undefined}
              showFullscreenToggle
              fullscreen={false}
              onFullscreenChange={() => setLargePreviewOpen(true)}
              className="min-h-0 flex-1"
            />
          </div>
          <PortalInvoicePreviewDialog
            open={largePreviewOpen}
            onOpenChange={setLargePreviewOpen}
            html={html}
            title={title}
            user={user}
            showSendEmail={isPortalManual}
            onSendEmail={isPortalManual ? () => {
              setLargePreviewOpen(false);
              setSendOpen(true);
            } : undefined}
          />
        </>
      ) : (
        <Alert>
          <AlertTitle>Bez náhledu</AlertTitle>
          <AlertDescription>
            U tohoto záznamu není uložený HTML náhled. Použijte export z detailu zakázky při vytvoření
            nebo upravte položky zálohové faktury.
          </AlertDescription>
        </Alert>
      )}

      {user && companyId && isPortalManual ? (
        <PortalInvoiceSendDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          companyId={companyId}
          invoiceId={invoiceId}
          invoiceNumber={title}
          defaultTo={defaultRecipientEmail}
          user={user}
        />
      ) : null}
    </div>
  );
}
