"use client";

import React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useCompany } from "@/firebase/firestore/use-company";
import { PortalCamerasHub } from "@/components/cameras/portal-cameras-hub";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { useCameraPermissions } from "@/hooks/use-camera-permissions";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { canAccessCompanyModule } from "@/lib/platform-access";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function PortalCamerasPage() {
  const { companyId, isLoading: companyLoading, companyDocMissing, company } = useCompany();
  const platformCatalog = useMergedPlatformModuleCatalog();
  const access = usePortalModuleAccess("cameras");
  const cameraPerms = useCameraPermissions();

  const moduleActive =
    company != null && canAccessCompanyModule(company, "cameras", platformCatalog);

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

  if (!moduleActive) {
    return (
      <Alert className="max-w-lg">
        <AlertTitle>Modul Kamery není aktivní</AlertTitle>
        <AlertDescription>
          Pro tuto organizaci není modul zapnutý nebo je globálně vypnutý. Aktivaci provedete v
          Nastavení → Předplatné / Moduly.
        </AlertDescription>
        <Button asChild className="mt-3" variant="outline" size="sm">
          <Link href="/portal/billing">Předplatné a moduly</Link>
        </Button>
      </Alert>
    );
  }

  if (!access.canRead || !cameraPerms.view) {
    return (
      <Alert className="max-w-lg">
        <AlertTitle>Bez oprávnění</AlertTitle>
        <AlertDescription>
          K modulu Kamery nemáte oprávnění. Požádejte administrátora organizace.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto w-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kamery</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hikvision (Hik-Connect Cloud nebo ISAPI) — náhledy přes zabezpečené API RAJMONDATA.
          </p>
        </div>
        {cameraPerms.admin ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/portal/settings?tab=organization">Nastavení Hikvision</Link>
          </Button>
        ) : null}
      </div>
      <PortalCamerasHub
        companyId={companyId}
        canLive={cameraPerms.live}
        canPlayback={cameraPerms.playback}
      />
    </div>
  );
}
