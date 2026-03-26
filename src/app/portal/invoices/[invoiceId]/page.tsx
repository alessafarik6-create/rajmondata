"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc } from "firebase/firestore";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, Printer, Download } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const { data: invoice, isLoading: invoiceLoading } = useDoc(invoiceRef);

  const html = useMemo(() => {
    const h = invoice && typeof (invoice as { pdfHtml?: string }).pdfHtml === "string"
      ? (invoice as { pdfHtml: string }).pdfHtml
      : "";
    return h.trim();
  }, [invoice]);

  const title = useMemo(() => {
    const inv = invoice as { invoiceNumber?: string; documentNumber?: string } | null;
    return String(inv?.invoiceNumber ?? inv?.documentNumber ?? "Doklad");
  }, [invoice]);

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

  if (profileLoading || (companyId && invoiceLoading)) {
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
    <div className="mx-auto max-w-4xl space-y-4 px-2 pb-10 sm:px-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/portal/invoices" aria-label="Zpět">
            <ChevronLeft className="h-6 w-6" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-neutral-950 sm:text-2xl">{title}</h1>
        <div className="ml-auto flex flex-wrap gap-2">
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
          <Button
            type="button"
            className="gap-2"
            disabled={!html}
            onClick={handleDownloadPdf}
          >
            <Download className="h-4 w-4" />
            Uložit jako PDF
          </Button>
        </div>
      </div>
      <p className="text-sm text-neutral-700">
        V prohlížeči zvolte „Uložit jako PDF“ v dialogu tisku (Ctrl+P).
      </p>
      {html ? (
        <div className="overflow-hidden rounded-lg border-2 border-neutral-950 bg-white shadow-sm">
          <iframe
            title={title}
            className="min-h-[70vh] w-full border-0 bg-white"
            srcDoc={html}
            sandbox="allow-modals allow-popups allow-same-origin"
          />
        </div>
      ) : (
        <Alert>
          <AlertTitle>Bez náhledu</AlertTitle>
          <AlertDescription>
            U tohoto záznamu není uložený HTML náhled. Použijte export z detailu zakázky při vytvoření.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
