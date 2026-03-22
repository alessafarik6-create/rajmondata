"use client";

import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";
import { useCompany, useUser } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Veřejná cesta `/terminal` — firma pouze z přihlášeného profilu (`users/{uid}.companyId`).
 * Parametr `?company=` se ignoruje.
 */
export default function TerminalPage() {
  const { user, isUserLoading } = useUser();
  const { isLoading, companyId } = useCompany();

  if (isUserLoading || isLoading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background text-foreground text-lg gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <span>Načítání terminálu…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 bg-background">
        <Alert className="max-w-md">
          <AlertTitle>Nejste přihlášeni</AlertTitle>
          <AlertDescription>Přihlaste se v portálu a otevřete terminál znovu.</AlertDescription>
        </Alert>
        <Button type="button" className="mt-4" variant="outline" onClick={() => (window.location.href = "/login")}>
          Přihlásit se
        </Button>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 bg-background">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Uživatel nemá přiřazenou firmu</AlertTitle>
          <AlertDescription>V profilu chybí companyId.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <AttendanceTerminal standalone />;
}
