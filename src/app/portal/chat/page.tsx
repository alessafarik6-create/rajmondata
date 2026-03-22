"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { useCompany } from "@/firebase/firestore/use-company";
import { CompanyChat } from "@/components/chat/CompanyChat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Chat administrace ↔ zaměstnanci (Firestore: companies/{companyId}/chat).
 */
export default function PortalChatPage() {
  const {
    companyId,
    isLoading: companyLoading,
    companyDocMissing,
  } = useCompany();

  if (companyLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Načítání…</span>
      </div>
    );
  }

  if (companyDocMissing) {
    return (
      <Alert variant="destructive" className="max-w-lg border-destructive/60">
        <AlertTitle>Firma neexistuje</AlertTitle>
        <AlertDescription>
          Dokument organizace ve Firestore chybí. Kontaktujte administrátora nebo podporu.
        </AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-lg">
        <AlertTitle>Chybí firma</AlertTitle>
        <AlertDescription>
          V profilu není nastavená organizace.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Zprávy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Komunikace se zaměstnanci firmy v reálném čase.
        </p>
      </div>
      <CompanyChat
        companyId={companyId}
        mode="admin"
        title="Firemní chat"
        placeholder="Napište odpověď zaměstnanci…"
      />
    </div>
  );
}
