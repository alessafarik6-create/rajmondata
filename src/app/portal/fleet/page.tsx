"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { FleetDashboardPage } from "@/components/fleet/fleet-dashboard-page";

export default function PortalFleetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <FleetDashboardPage />
    </Suspense>
  );
}
