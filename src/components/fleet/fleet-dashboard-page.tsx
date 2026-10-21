"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { useToast } from "@/hooks/use-toast";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { FleetMap } from "@/components/fleet/fleet-map";
import { FleetGpsNotConnectedPanel } from "@/components/fleet/fleet-gps-not-connected-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { movementStatusLabel } from "@/lib/fleet/providers/types";
import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";
import { cn } from "@/lib/utils";

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
    withoutGps?: number;
    todayKm: number;
    monthKm?: number;
  };
  vehicles: {
    id: string;
    name: string;
    licensePlate: string;
    currentDriverName: string | null;
    lastMovementStatus: FleetVehicleMovementStatus;
    lastSpeedKmh: number | null;
    lastHeadingDeg?: number | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    lastLocationLabel: string | null;
    lastPositionAt: string | null;
    todayDistanceKm: number | null;
    externalVehicleId?: string | null;
    ignitionOn?: boolean | null;
    odometerKm?: number | null;
    lastTelemetry?: Record<string, unknown> | null;
  }[];
  positions: {
    vehicleId: string;
    lat: number;
    lng: number;
    speedKmh?: number | null;
    headingDeg?: number | null;
    movementStatus: FleetVehicleMovementStatus;
    recordedAt: string;
    locationLabel?: string | null;
  }[];
};

export function FleetDashboardPage() {
  const { user } = useUser();
  const { companyId, userProfile } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const hasLoadedOnce = useRef(false);

  const role = String((userProfile as { role?: string } | null)?.role ?? "");
  const globalRoles = (userProfile as { globalRoles?: string[] } | null)?.globalRoles ?? [];
  const canManageIntegration =
    role === "owner" || role === "admin" || globalRoles.includes("super_admin");

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/fleet/dashboard?companyId=${encodeURIComponent(companyId)}&live=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.ok) {
        setData(json);
        hasLoadedOnce.current = true;
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead]);

  useEffect(() => {
    void load();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    };
    const t = window.setInterval(tick, 12_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus) setSelectedId(focus);
  }, [searchParams]);

  useEffect(() => {
    const sat = searchParams.get("satelitni");
    if (!sat) return;
    if (sat === "connected") {
      toast({ title: "SatelitníSledování.cz připojeno" });
      void load();
    } else if (sat === "error") {
      toast({
        variant: "destructive",
        title: "Připojení SatelitníSledování.cz",
        description: "OAuth se nepodařilo dokončit. Zkuste to znovu v Nastavení → Integrace.",
      });
    }
    router.replace("/portal/fleet");
  }, [searchParams, toast, router, load]);

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
          headingDeg: p.headingDeg ?? v?.lastHeadingDeg,
          driverName: v?.currentDriverName,
          movementStatus: p.movementStatus,
          lastUpdate: p.recordedAt,
          todayKm: v?.todayDistanceKm,
        };
      });
  }, [data]);

  const selectedVehicle = data?.vehicles.find((v) => v.id === selectedId);
  const mapHeight = fullscreen ? "calc(100vh - 120px)" : "min(70vh, 680px)";

  if (!access.canRead) {
    return <p className="p-6 text-muted-foreground">Nemáte oprávnění k modulu Vozový park.</p>;
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = data?.stats ?? {
    total: 0,
    online: 0,
    moving: 0,
    idle: 0,
    offline: 0,
    todayKm: 0,
    monthKm: 0,
  };

  const mapBlock = (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="absolute z-[1001] top-3 left-3 gap-1 shadow"
        onClick={() => setFullscreen((f) => !f)}
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        {fullscreen ? "Ukončit celou obrazovku" : "Celá obrazovka"}
      </Button>
      <FleetMap
        markers={markers}
        selectedVehicleId={selectedId}
        onSelectVehicle={setSelectedId}
        height={mapHeight}
      />
      {data && data.vehicles.length > 0 && markers.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Máte {data.vehicles.length} vozidel v seznamu, ale žádné nemá platnou GPS polohu. Spusťte synchronizaci v
          Nastavení → Integrace.
        </p>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        fullscreen ? "fixed inset-0 z-50 bg-background p-4 overflow-auto" : "p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto"
      )}
    >
      {!fullscreen ? <FleetSubnav /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Vozový park</h1>
        {data?.demoMode ? <Badge variant="secondary">DEMO DATA</Badge> : null}
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      {!fullscreen && data && !data.gpsConnected && companyId ? (
        <FleetGpsNotConnectedPanel companyId={companyId} canManageIntegration={canManageIntegration} />
      ) : !fullscreen && data?.message ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">{data.message}</CardContent>
        </Card>
      ) : null}

      {!fullscreen ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {[
            ["Vozidel celkem", stats.total],
            ["Právě jede", stats.moving],
            ["Stojí", stats.idle],
            ["Offline / bez signálu", stats.offline],
            ["Bez GPS polohy", stats.withoutGps ?? Math.max(0, stats.total - markers.length)],
            ["Dnes ujeto km", Math.round(stats.todayKm)],
            ["Tento měsíc km", Math.round(stats.monthKm ?? 0)],
          ].map(([label, val]) => (
            <Card key={String(label)}>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 text-2xl font-semibold">{val}</CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {mapBlock}

      {selectedVehicle ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {selectedVehicle.name} – {selectedVehicle.licensePlate}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 flex flex-wrap gap-4 items-start justify-between">
            <div className="space-y-1">
              <p>
                Stav: <strong>{movementStatusLabel(selectedVehicle.lastMovementStatus)}</strong>
              </p>
              <p>Řidič: {selectedVehicle.currentDriverName ?? "—"}</p>
              <p>
                Rychlost:{" "}
                {selectedVehicle.lastSpeedKmh != null ? `${Math.round(selectedVehicle.lastSpeedKmh)} km/h` : "—"}
              </p>
              <p>
                Zapalování:{" "}
                {selectedVehicle.ignitionOn === true
                  ? "Zapnuto"
                  : selectedVehicle.ignitionOn === false
                    ? "Vypnuto"
                    : "—"}
              </p>
              <p>
                Tachometr:{" "}
                {selectedVehicle.odometerKm != null
                  ? `${Math.round(selectedVehicle.odometerKm)} km`
                  : selectedVehicle.lastTelemetry?.odometerKm != null
                    ? `${Math.round(Number(selectedVehicle.lastTelemetry.odometerKm))} km`
                    : "—"}
              </p>
              <p>Poslední poloha: {selectedVehicle.lastLocationLabel ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {selectedVehicle.lastPositionAt
                  ? new Date(selectedVehicle.lastPositionAt).toLocaleString("cs-CZ")
                  : "GPS poloha zatím neznámá"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link href={`/portal/fleet/vehicles/${selectedVehicle.id}`}>Detail vozidla</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/portal/fleet/trips?vehicleId=${encodeURIComponent(selectedVehicle.id)}`}>
                  Historie tras
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/portal/fleet/trips?vehicleId=${encodeURIComponent(selectedVehicle.id)}&logbook=1`}>
                  Kniha jízd
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!fullscreen ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                {["Vozidlo", "SPZ", "Stav", "Řidič", "Rychlost", "Poloha", "Poslední GPS", "Dnes km"].map((h) => (
                  <th key={h} className="p-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.vehicles ?? []).map((v) => (
                <tr
                  key={v.id}
                  className={cn("border-t cursor-pointer hover:bg-muted/30", selectedId === v.id && "bg-muted/40")}
                  onClick={() => setSelectedId(v.id)}
                >
                  <td className="p-3 font-medium">{v.name}</td>
                  <td className="p-3">{v.licensePlate}</td>
                  <td className="p-3">{movementStatusLabel(v.lastMovementStatus)}</td>
                  <td className="p-3">{v.currentDriverName ?? "—"}</td>
                  <td className="p-3">
                    {v.lastSpeedKmh != null ? `${Math.round(v.lastSpeedKmh)} km/h` : "—"}
                  </td>
                  <td className="p-3 max-w-[200px] truncate">{v.lastLocationLabel ?? "—"}</td>
                  <td className="p-3 text-xs whitespace-nowrap">
                    {v.lastPositionAt ? new Date(v.lastPositionAt).toLocaleString("cs-CZ") : "—"}
                  </td>
                  <td className="p-3">{v.todayDistanceKm ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
