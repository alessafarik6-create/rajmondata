"use client";

import { use } from "react";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";
import { useCompany, useUser } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * `/companies/[companyId]/terminal` — ověření, že URL odpovídá `user.companyId` (žádný override z URL).
 */
export default function CompanyTerminalPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId: routeCompanyId } = use(params);
  const { user, isUserLoading } = useUser();
  const { companyId, isLoading } = useCompany();

  if (isUserLoading || isLoading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <span className="text-muted-foreground">Načítání…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh grid place-items-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Nejste přihlášeni</AlertTitle>
          <AlertDescription>Pro tento terminál se přihlaste.</AlertDescription>
        </Alert>
        <Button type="button" className="mt-4" variant="outline" onClick={() => (window.location.href = "/login")}>
          Přihlásit se
        </Button>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="min-h-dvh grid place-items-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Uživatel nemá přiřazenou firmu</AlertTitle>
          <AlertDescription>V profilu chybí companyId.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (companyId !== routeCompanyId) {
    return (
      <div className="min-h-dvh grid place-items-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Neplatný odkaz</AlertTitle>
          <AlertDescription>
            Tato adresa neodpovídá firmě vašeho účtu. Použijte odkaz z portálu nebo správnou adresu firmy.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <AttendanceTerminal standalone />;
}
