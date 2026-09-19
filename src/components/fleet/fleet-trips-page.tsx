"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export function FleetTripsPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const [trips, setTrips] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleId, setVehicleId] = useState("");
  const [jobId, setJobId] = useState("");

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const q = new URLSearchParams({ companyId });
      if (vehicleId.trim()) q.set("vehicleId", vehicleId.trim());
      if (jobId.trim()) q.set("jobId", jobId.trim());
      const res = await fetch(`/api/company/fleet/trips?${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) setTrips(data.trips ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead, vehicleId, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!access.canRead) return <p className="p-6 text-muted-foreground">Nemáte oprávnění.</p>;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <FleetSubnav />
      <h1 className="text-2xl font-semibold mb-4">Přehled jízd</h1>
      <div className="grid gap-2 sm:grid-cols-3 mb-4">
        <Input placeholder="ID vozidla" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} />
        <Input placeholder="ID zakázky" value={jobId} onChange={(e) => setJobId(e.target.value)} />
      </div>
      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                {["Datum", "Vozidlo", "Řidič", "Odkud", "Kam", "Odjezd", "Příjezd", "Doba", "Km", "Stání", "Zakázka"].map(
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
                  <td colSpan={11} className="p-6 text-center text-muted-foreground">
                    Zatím žádné jízdy. Historie se načte z Ecofleet po integraci nebo z demo režimu (FLEET_DEMO_DATA=1).
                  </td>
                </tr>
              ) : (
                trips.map((t) => (
                  <tr key={String(t.id)} className="border-t">
                    <td className="p-2">{t.startedAt ? new Date(String(t.startedAt)).toLocaleDateString("cs-CZ") : "—"}</td>
                    <td className="p-2">{String(t.vehicleId)}</td>
                    <td className="p-2">{String(t.driverName ?? "—")}</td>
                    <td className="p-2">{String(t.startAddress ?? "—")}</td>
                    <td className="p-2">{String(t.endAddress ?? "—")}</td>
                    <td className="p-2">{t.startedAt ? new Date(String(t.startedAt)).toLocaleTimeString("cs-CZ") : "—"}</td>
                    <td className="p-2">{t.endedAt ? new Date(String(t.endedAt)).toLocaleTimeString("cs-CZ") : "—"}</td>
                    <td className="p-2">{String(t.durationMinutes ?? "—")} min</td>
                    <td className="p-2">{String(t.distanceKm ?? "—")}</td>
                    <td className="p-2">{String(t.idleMinutes ?? "—")} min</td>
                    <td className="p-2">{String(t.jobLabel ?? t.jobId ?? "—")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
