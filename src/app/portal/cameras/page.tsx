"use client";

import React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useCompany } from "@/firebase/firestore/use-company";
import { CamerasGrid } from "@/components/cameras/cameras-grid";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function PortalCamerasPage() {
  const { companyId, isLoading: companyLoading, companyDocMissing } = useCompany();
  const access = usePortalModuleAccess("cameras");

  if (companyLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Načítání…</span>
      </div>
    );
  }

  if (companyDocMissing || !companyId) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertTitle>Chybí firma</AlertTitle>
        <AlertDescription>Organizace není k dispozici.</AlertDescription>
      </Alert>
    );
  }

  if (!access.canRead) {
    return (
      <Alert className="max-w-lg">
        <AlertTitle>Bez oprávnění</AlertTitle>
        <AlertDescription>Modul Kamery nemáte povolený.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto w-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kamery</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hikvision NVR — náhledy přes zabezpečené API RAJMONDATA.
          </p>
        </div>
        {access.canWrite ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/portal/settings?tab=organization">Nastavení Hikvision</Link>
          </Button>
        ) : null}
      </div>
      <CamerasGrid companyId={companyId} />
    </div>
  );
}
