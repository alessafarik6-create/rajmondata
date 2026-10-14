"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { FleetMap } from "@/components/fleet/fleet-map";
import { FleetTripRoutePlayer } from "@/components/fleet/fleet-trip-route-player";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download } from "lucide-react";
import { cn } from "@/lib/utils";

type PeriodPreset = "all" | "today" | "yesterday" | "week" | "month" | "custom";

function periodRange(preset: PeriodPreset): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString();
  if (preset === "all") return {};
  if (preset === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to };
  }
  if (preset === "yesterday") {
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const end = new Date(from);
    end.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: end.toISOString() };
  }
  if (preset === "week") {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString(), to };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString(), to };
}

export function FleetTripsPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const searchParams = useSearchParams();
  const [trips, setTrips] = useState<Record<string, unknown>[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; licensePlate: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleId, setVehicleId] = useState(searchParams.get("vehicleId") ?? "");
  const [driverFilter, setDriverFilter] = useState("");
  const [tripType, setTripType] = useState<string>("all");
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [route, setRoute] = useState<{
    points: { lat: number; lng: number; recordedAt?: string | null }[];
    start?: { lat: number; lng: number; label?: string };
    end?: { lat: number; lng: number; label?: string };
  } | null>(null);
  const [playIndex, setPlayIndex] = useState(0);

  const logbookMode = searchParams.get("logbook") === "1";

  useEffect(() => {
    if (!user || !companyId) return;
    void (async () => {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/fleet/vehicles?companyId=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) setVehicles(data.vehicles ?? []);
    })();
  }, [user, companyId]);

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const q = new URLSearchParams({ companyId });
      if (vehicleId.trim()) q.set("vehicleId", vehicleId.trim());
      if (tripType === "business" || tripType === "private") q.set("tripType", tripType);
      const range =
        preset === "custom"
          ? {
              from: fromDate ? new Date(fromDate).toISOString() : undefined,
              to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
            }
          : periodRange(preset);
      if (range.from) q.set("from", range.from);
      if (range.to) q.set("to", range.to);
      const res = await fetch(`/api/company/fleet/trips?${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        let list = data.trips ?? [];
        if (driverFilter.trim()) {
          const d = driverFilter.trim().toLowerCase();
          list = list.filter((t: Record<string, unknown>) =>
            String(t.driverName ?? "").toLowerCase().includes(d)
          );
        }
        setTrips(list);
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead, vehicleId, tripType, preset, fromDate, toDate, driverFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedTripId || !user || !companyId) {
      setRoute(null);
      setPlayIndex(0);
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
        setPlayIndex(0);
      } else {
        setRoute(null);
      }
    })();
  }, [selectedTripId, user, companyId]);

  const exportUrl = useMemo(() => {
    if (!companyId) return null;
    const q = new URLSearchParams({ companyId });
    if (vehicleId.trim()) q.set("vehicleId", vehicleId.trim());
    if (tripType === "business" || tripType === "private") q.set("tripType", tripType);
    const range = preset === "custom" ? {} : periodRange(preset);
    if (preset === "custom") {
      if (fromDate) q.set("from", new Date(fromDate).toISOString());
      if (toDate) q.set("to", new Date(`${toDate}T23:59:59`).toISOString());
    } else {
      if (range.from) q.set("from", range.from);
      if (range.to) q.set("to", range.to!);
    }
    return q;
  }, [companyId, vehicleId, tripType, preset, fromDate, toDate]);

  async function downloadExport(format: "csv" | "xlsx" | "pdf") {
    if (!user || !exportUrl) return;
    const token = await user.getIdToken();
    exportUrl.set("format", format);
    const res = await fetch(`/api/company/fleet/trips/export?${exportUrl}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kniha-jizd.${format === "xlsx" ? "xlsx" : format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!access.canRead) return <p className="p-6 text-muted-foreground">Nemáte oprávnění.</p>;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <FleetSubnav />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{logbookMode ? "Kniha jízd" : "Historie jízd"}</h1>
        <div className="flex flex-wrap gap-2">
          {(["csv", "xlsx", "pdf"] as const).map((f) => (
            <Button key={f} size="sm" variant="outline" className="gap-1" onClick={() => void downloadExport(f)}>
              <Download className="h-4 w-4" />
              {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label>Vozidlo</Label>
          <Select value={vehicleId || "__all"} onValueChange={(v) => setVehicleId(v === "__all" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Všechna vozidla" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Všechna vozidla</SelectItem>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.licensePlate} — {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Řidič (filtr)</Label>
          <Input value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} placeholder="Jméno řidiče" />
        </div>
        <div className="space-y-1">
          <Label>Období</Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Dnes</SelectItem>
              <SelectItem value="yesterday">Včera</SelectItem>
              <SelectItem value="week">Tento týden</SelectItem>
              <SelectItem value="month">Tento měsíc</SelectItem>
              <SelectItem value="all">Bez limitu (poslední záznamy)</SelectItem>
              <SelectItem value="custom">Vlastní rozsah</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Typ jízdy</Label>
          <Select value={tripType} onValueChange={setTripType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Vše</SelectItem>
              <SelectItem value="business">Služební</SelectItem>
              <SelectItem value="private">Soukromé</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {preset === "custom" ? (
        <div className="grid gap-2 sm:grid-cols-2 max-w-md">
          <div className="space-y-1">
            <Label>Datum od</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Datum do</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
      ) : null}

      {selectedTripId && route ? (
        <div className="space-y-2">
          <FleetMap route={route} markers={[]} height="320px" playheadIndex={playIndex} />
          <FleetTripRoutePlayer
            points={route.points}
            onIndexChange={(i) => setPlayIndex(i)}
          />
        </div>
      ) : null}

      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                {["Datum", "Vozidlo", "Řidič", "Odkud", "Kam", "Odjezd", "Příjezd", "Km", "Typ", "Zakázka"].map(
                  (h) => (
                    <th key={h} className="p-2">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-muted-foreground">
                    V zvoleném období nejsou jízdy. Data pocházejí ze SatelitníSledování.cz (synchronizace jízd po
                    připojení GPS). Zpětně nelze doplnit období, která provider neuchoval.
                  </td>
                </tr>
              ) : (
                trips.map((t) => {
                  const vid = String(t.vehicleId);
                  const veh = vehicles.find((v) => v.id === vid);
                  const typeCs = t.tripType === "private" ? "Soukromá" : "Služební";
                  return (
                    <tr
                      key={String(t.id)}
                      className={cn(
                        "border-t cursor-pointer hover:bg-muted/30",
                        selectedTripId === t.id && "bg-muted/50"
                      )}
                      onClick={() => setSelectedTripId(String(t.id))}
                    >
                      <td className="p-2">
                        {t.startedAt ? new Date(String(t.startedAt)).toLocaleDateString("cs-CZ") : "—"}
                      </td>
                      <td className="p-2">{veh ? `${veh.licensePlate}` : vid}</td>
                      <td className="p-2">{String(t.driverName ?? "—")}</td>
                      <td className="p-2 max-w-[140px] truncate">{String(t.startAddress ?? "—")}</td>
                      <td className="p-2 max-w-[140px] truncate">{String(t.endAddress ?? "—")}</td>
                      <td className="p-2">
                        {t.startedAt ? new Date(String(t.startedAt)).toLocaleTimeString("cs-CZ") : "—"}
                      </td>
                      <td className="p-2">
                        {t.endedAt ? new Date(String(t.endedAt)).toLocaleTimeString("cs-CZ") : "—"}
                      </td>
                      <td className="p-2">{String(t.distanceKm ?? "—")}</td>
                      <td className="p-2">{typeCs}</td>
                      <td className="p-2">{String(t.jobLabel ?? t.jobId ?? "—")}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
