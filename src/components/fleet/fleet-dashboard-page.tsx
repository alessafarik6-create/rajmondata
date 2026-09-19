"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { FleetMap } from "@/components/fleet/fleet-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { movementStatusLabel } from "@/lib/fleet/providers/types";
import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";

type DashData = {
  gpsConnected: boolean;
  demoMode: boolean;
  message: string | null;
  stats: {
    total: number;
    online: number;
    moving: number;
    idle: number;
    offline: number;
    todayKm: number;
  };
  vehicles: {
    id: string;
    name: string;
    licensePlate: string;
    currentDriverName: string | null;
    lastMovementStatus: FleetVehicleMovementStatus;
    lastSpeedKmh: number | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    lastLocationLabel: string | null;
    lastPositionAt: string | null;
    todayDistanceKm: number | null;
  }[];
  positions: {
    vehicleId: string;
    lat: number;
    lng: number;
    speedKmh?: number | null;
    movementStatus: FleetVehicleMovementStatus;
    recordedAt: string;
    locationLabel?: string | null;
  }[];
};

export function FleetDashboardPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/fleet/dashboard?companyId=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const markers = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.vehicles.map((v) => [v.id, v]));
    return data.positions
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => {
        const v = byId.get(p.vehicleId);
        return {
          id: p.vehicleId,
          label: v?.name ?? p.vehicleId,
          licensePlate: v?.licensePlate ?? "—",
          lat: p.lat,
          lng: p.lng,
          speedKmh: p.speedKmh,
          driverName: v?.currentDriverName,
          movementStatus: p.movementStatus,
          lastUpdate: p.recordedAt,
          todayKm: v?.todayDistanceKm,
        };
      });
  }, [data]);

  const selectedVehicle = data?.vehicles.find((v) => v.id === selectedId);

  if (!access.canRead) {
    return <p className="p-6 text-muted-foreground">Nemáte oprávnění k modulu Vozový park.</p>;
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = data?.stats ?? { total: 0, online: 0, moving: 0, idle: 0, offline: 0, todayKm: 0 };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <FleetSubnav />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Vozový park</h1>
        {data?.demoMode ? <Badge variant="secondary">DEMO DATA</Badge> : null}
      </div>
      {data?.message ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">{data.message}</CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ["Vozidla celkem", stats.total],
          ["Online", stats.online],
          ["V pohybu", stats.moving],
          ["Stojí", stats.idle],
          ["Offline", stats.offline],
          ["Dnes ujeto km", Math.round(stats.todayKm)],
        ].map(([label, val]) => (
          <Card key={String(label)}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 text-2xl font-semibold">{val}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <FleetMap markers={markers} selectedVehicleId={selectedId} onSelectVehicle={setSelectedId} height="min(55vh, 520px)" />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detail vozidla</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {!selectedVehicle ? (
              <p className="text-muted-foreground">Klikněte na vozidlo na mapě.</p>
            ) : (
              <>
                <p className="font-semibold">{selectedVehicle.licensePlate}</p>
                <p>{selectedVehicle.name}</p>
                <p>Řidič: {selectedVehicle.currentDriverName ?? "—"}</p>
                <p>Stav: {movementStatusLabel(selectedVehicle.lastMovementStatus)}</p>
                <p>Rychlost: {selectedVehicle.lastSpeedKmh != null ? `${Math.round(selectedVehicle.lastSpeedKmh)} km/h` : "—"}</p>
                <p>Poloha: {selectedVehicle.lastLocationLabel ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  GPS:{" "}
                  {selectedVehicle.lastPositionAt
                    ? new Date(selectedVehicle.lastPositionAt).toLocaleString("cs-CZ")
                    : "—"}
                </p>
                <p>Dnes: {selectedVehicle.todayDistanceKm ?? 0} km</p>
                <Button size="sm" className="w-full mt-2" asChild>
                  <Link href={`/portal/fleet/vehicles/${selectedVehicle.id}`}>Detail vozidla</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
