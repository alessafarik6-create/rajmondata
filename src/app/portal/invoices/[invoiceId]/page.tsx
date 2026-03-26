"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, Printer, Download, Pencil } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";

export default function InvoiceDocumentPage() {
  const params = useParams();
  const invoiceId = typeof params?.invoiceId === "string" ? params.invoiceId : "";
  const { user } = useUser();
  const firestore = useFirestore();

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

  const html = useMemo(() => {
    const h =
      invoice && typeof (invoice as { pdfHtml?: string }).pdfHtml === "string"
        ? (invoice as { pdfHtml: string }).pdfHtml
        : "";
    return h.trim();
  }, [invoice]);

  const [iframeSrc, setIframeSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!html) {
      setIframeSrc(null);
      return;
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setIframeSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [html]);

  const title = useMemo(() => {
    const inv = invoice as { invoiceNumber?: string; documentNumber?: string } | null;
    return String(inv?.invoiceNumber ?? inv?.documentNumber ?? "Doklad");
  }, [invoice]);

  const isAdvance =
    invoice &&
    String((invoice as { type?: string }).type ?? "") === JOB_INVOICE_TYPES.ADVANCE;

  const handlePrint = () => {
    if (!html) return;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.document.title = title;
    w.focus();
    w.print();
  };

  const handleDownloadPdf = () => {
    handlePrint();
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
          <Link href="/portal/invoices" className="underline">
            Zpět na faktury
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
          <Link href="/portal/invoices" className="underline">
            Zpět na faktury
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-2 pb-10 sm:px-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/portal/invoices" aria-label="Zpět">
            <ChevronLeft className="h-6 w-6" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-neutral-950 sm:text-2xl">{title}</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {isAdvance ? (
            <Button type="button" variant="outline" className="gap-2 border-neutral-950" asChild>
              <Link href={`/portal/invoices/${invoiceId}/edit`}>
                <Pencil className="h-4 w-4" />
                Upravit položky
              </Link>
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
          <Button type="button" className="gap-2" disabled={!html} onClick={handleDownloadPdf}>
            <Download className="h-4 w-4" />
            Uložit jako PDF
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-700">
        V prohlížeči zvolte „Uložit jako PDF“ v dialogu tisku (Ctrl+P). Náhled je ve formátu A4.
      </p>
      {html && iframeSrc ? (
        <div className="invoice-a4-preview overflow-auto rounded-lg border-2 border-neutral-950 bg-neutral-200 py-6">
          <iframe
            title={title}
            className="mx-auto block min-h-[1123px] w-full max-w-[210mm] border-0 bg-white shadow-md"
            src={iframeSrc}
          />
        </div>
      ) : html && !iframeSrc ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Alert>
          <AlertTitle>Bez náhledu</AlertTitle>
          <AlertDescription>
            U tohoto záznamu není uložený HTML náhled. Použijte export z detailu zakázky při vytvoření
            nebo upravte položky zálohové faktury.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
