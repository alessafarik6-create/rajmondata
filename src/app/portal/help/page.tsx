"use client";

import React from "react";
import Link from "next/link";
import { SupportPage } from "@/components/portal/support/SupportPage";

export default function PortalHelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Nápověda</h1>
        <p className="portal-page-description mt-1 text-muted-foreground">
          Kontextová nápověda je dostupná v pravém dolním rohu (ikonka zprávy). Níže můžete kontaktovat
          provozovatele platformy.
        </p>
      </div>
      <SupportPage />
      <p className="text-xs text-muted-foreground">
        Zpět na <Link href="/portal/dashboard" className="text-primary underline">přehled</Link>.
      </p>
    </div>
  );
}
