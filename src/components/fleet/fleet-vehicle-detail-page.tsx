"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { FleetMap } from "@/components/fleet/fleet-map";
import { FleetDayTimeline } from "@/components/fleet/fleet-day-timeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { movementStatusLabel } from "@/lib/fleet/providers/types";

export function FleetVehicleDetailPage({ vehicleId }: { vehicleId: string }) {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const [vehicle, setVehicle] = useState<Record<string, unknown> | null>(null);
  const [assignments, setAssignments] = useState<{ driverName: string | null; assignedFrom: string | null }[]>([]);
  const [trips, setTrips] = useState<Record<string, unknown>[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [route, setRoute] = useState<{ points: { lat: number; lng: number }[]; start?: { lat: number; lng: number; label?: string }; end?: { lat: number; lng: number; label?: string } } | null>(null);
  const [period, setPeriod] = useState<"today" | "yesterday" | "week" | "custom">("today");
  const [driverName, setDriverName] = useState("");
  const [loading, setLoading] = useState(true);

  const loadVehicle = useCallback(async () => {
    if (!user || !companyId) return;
    const token = await user.getIdToken();
    const res = await fetch(
      `/api/company/fleet/vehicles/${vehicleId}?companyId=${encodeURIComponent(companyId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.ok) {
      setVehicle(data.vehicle);
      setAssignments(data.assignments ?? []);
      setDriverName(String(data.vehicle?.currentDriverName ?? ""));
    }
  }, [user, companyId, vehicleId]);

  const loadTrips = useCallback(async () => {
    if (!user || !companyId) return;
    const token = await user.getIdToken();
    const now = new Date();
    const from = new Date(now);
    if (period === "today") from.setHours(0, 0, 0, 0);
    else if (period === "yesterday") {
      from.setDate(from.getDate() - 1);
      from.setHours(0, 0, 0, 0);
      now.setDate(now.getDate() - 1);
      now.setHours(23, 59, 59, 999);
    } else from.setDate(from.getDate() - 7);
    const q = new URLSearchParams({
      companyId,
      vehicleId,
      from: from.toISOString(),
      to: now.toISOString(),
    });
    const res = await fetch(`/api/company/fleet/trips?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ok) setTrips(data.trips ?? []);
  }, [user, companyId, vehicleId, period]);

  useEffect(() => {
    if (!access.canRead) return;
    setLoading(true);
    Promise.all([loadVehicle(), loadTrips()]).finally(() => setLoading(false));
  }, [access.canRead, loadVehicle, loadTrips]);

  useEffect(() => {
    if (!selectedTripId || !user || !companyId) {
      setRoute(null);
      return;
    }
    void (async () => {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/fleet/trips/${selectedTripId}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok && data.route) {
        setRoute({
          points: data.route.points ?? [],
          start: data.route.start
            ? { lat: data.route.start.lat, lng: data.route.start.lng, label: data.route.start.address }
            : undefined,
          end: data.route.end
            ? { lat: data.route.end.lat, lng: data.route.end.lng, label: data.route.end.address }
            : undefined,
        });
      }
    })();
  }, [selectedTripId, user, companyId]);

  const timeline = useMemo(() => {
    if (!route?.start || !route?.end) return [];
    return [
      { kind: "drive" as const, label: `${route.start.label ?? "Start"} → ${route.end.label ?? "Cíl"}`, from: new Date().toISOString(), to: null },
      ...(route.points.length
        ? [{ kind: "stop" as const, label: "Zastávka", from: new Date().toISOString(), to: null }]
        : []),
    ];
  }, [route]);

  async function assignDriver() {
    if (!user || !companyId || !access.canWrite) return;
    const token = await user.getIdToken();
    await fetch(`/api/company/fleet/vehicles/${vehicleId}/assignments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        driverUserId: user.uid,
        driverName: driverName.trim(),
      }),
    });
    await loadVehicle();
  }

  if (!access.canRead) return <p className="p-6 text-muted-foreground">Nemáte oprávnění.</p>;
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!vehicle) return <p className="p-6">Vozidlo nenalezeno.</p>;

  const lat = vehicle.lastLatitude as number | null;
  const lng = vehicle.lastLongitude as number | null;
  const markers =
    lat != null && lng != null
      ? [
          {
            id: vehicleId,
            label: String(vehicle.name),
            licensePlate: String(vehicle.licensePlate),
            lat,
            lng,
            movementStatus: (vehicle.lastMovementStatus as never) ?? "unknown",
            speedKmh: vehicle.lastSpeedKmh as number | null,
            driverName: vehicle.currentDriverName as string | null,
            lastUpdate: vehicle.lastPositionAt as string | null,
          },
        ]
      : [];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <FleetSubnav />
      <Button variant="ghost" size="sm" asChild>
        <Link href="/portal/fleet/vehicles">← Seznam vozidel</Link>
      </Button>
      <h1 className="text-2xl font-semibold">
        {String(vehicle.name)} · {String(vehicle.licensePlate)}
      </h1>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Přehled</TabsTrigger>
          <TabsTrigger value="history">Historie jízd</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Údaje vozidla</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p>VIN: {String(vehicle.vin ?? "—")}</p>
                <p>
                  {String(vehicle.make ?? "")} {String(vehicle.model ?? "")}{" "}
                  {vehicle.year != null ? String(vehicle.year) : ""}
                </p>
                <p>Řidič: {String(vehicle.currentDriverName ?? "—")}</p>
                <p>GPS zařízení: {String(vehicle.externalDeviceId ?? "Nepřipojeno")}</p>
                <p>Ecofleet ID: {String(vehicle.externalVehicleId ?? "—")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Aktuální stav</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p>Stav: {movementStatusLabel((vehicle.lastMovementStatus as never) ?? "unknown")}</p>
                <p>Rychlost: {vehicle.lastSpeedKmh != null ? `${vehicle.lastSpeedKmh} km/h` : "—"}</p>
                <p>Poloha: {String(vehicle.lastLocationLabel ?? "—")}</p>
                <p>
                  Poslední GPS:{" "}
                  {vehicle.lastPositionAt
                    ? new Date(String(vehicle.lastPositionAt)).toLocaleString("cs-CZ")
                    : "—"}
                </p>
              </CardContent>
            </Card>
          </div>
          {access.canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Přiřadit řidiče</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <Label>Jméno řidiče</Label>
                  <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
                </div>
                <Button onClick={() => void assignDriver()}>Uložit přiřazení</Button>
              </CardContent>
            </Card>
          ) : null}
          {assignments.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historie řidičů</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {assignments.map((a, i) => (
                  <p key={i}>
                    {a.driverName ?? "—"}{" "}
                    <span className="text-muted-foreground text-xs">
                      od {a.assignedFrom ? new Date(a.assignedFrom).toLocaleDateString("cs-CZ") : "—"}
                    </span>
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {markers.length ? <FleetMap markers={markers} height="320px" /> : null}
        </TabsContent>
        <TabsContent value="history" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2">
            {(["today", "yesterday", "week"] as const).map((p) => (
              <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
                {p === "today" ? "Dnes" : p === "yesterday" ? "Včera" : "7 dní"}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {trips.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné jízdy v období (GPS historie po napojení Ecofleet).</p>
              ) : (
                trips.map((t) => (
                  <button
                    key={String(t.id)}
                    type="button"
                    className="w-full text-left rounded-lg border p-3 text-sm hover:bg-muted/50"
                    onClick={() => setSelectedTripId(String(t.id))}
                  >
                    <p className="font-medium">
                      {String(t.startAddress ?? "Start")} → {String(t.endAddress ?? "Cíl")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t.startedAt ? new Date(String(t.startedAt)).toLocaleString("cs-CZ") : ""} · {String(t.distanceKm ?? "—")} km ·{" "}
                      {String(t.durationMinutes ?? "—")} min
                    </p>
                  </button>
                ))
              )}
            </div>
            <div className="space-y-3">
              <FleetMap markers={[]} route={route} height="280px" />
              <FleetDayTimeline segments={timeline} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
