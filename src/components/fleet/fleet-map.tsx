"use client";

import dynamic from "next/dynamic";
import type { FleetMapVehicleMarker, FleetMapRoute } from "@/components/fleet/fleet-map-inner";

export type FleetMapProps = {
  markers: FleetMapVehicleMarker[];
  route?: FleetMapRoute | null;
  height?: string;
  onSelectVehicle?: (id: string) => void;
  selectedVehicleId?: string | null;
};

const FleetMapInner = dynamic(
  () => import("@/components/fleet/fleet-map-inner").then((m) => m.FleetMapInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
        Načítám mapu…
      </div>
    ),
  }
);

export function FleetMap(props: FleetMapProps) {
  return <FleetMapInner {...props} />;
}

// re-export types for consumers
export type { FleetMapVehicleMarker, FleetMapRoute } from "@/components/fleet/fleet-map-inner";
