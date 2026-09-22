"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { useCompany } from "@/firebase/firestore/use-company";
import { CompanyChat } from "@/components/chat/CompanyChat";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Chat administrace ↔ zaměstnanci (Firestore: companies/{companyId}/chat).
 */
export default function PortalChatPage() {
  const {
    companyId,
    isLoading: companyLoading,
    companyDocMissing,
  } = useCompany();
  const { canWrite: canWriteChat } = usePortalModuleAccess("chat");
  const isMobile = useIsMobile();

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
    <div
      className={cn(
        "flex flex-col w-full min-h-0",
        isMobile
          ? "flex-1 min-h-0 h-full max-h-full overflow-hidden"
          : "gap-4 max-w-5xl mx-auto"
      )}
    >
      {!isMobile ? (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Zprávy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Komunikace se zaměstnanci firmy v reálném čase.
          </p>
        </div>
      ) : null}
      <CompanyChat
        companyId={companyId}
        mode="admin"
        title="Zprávy"
        fullScreenMobile={isMobile}
        placeholder={
          canWriteChat ? "Napište zprávu…" : "Máte pouze náhled — odesílání zpráv je vypnuto."
        }
        readOnly={!canWriteChat}
      />
    </div>
  );
}
