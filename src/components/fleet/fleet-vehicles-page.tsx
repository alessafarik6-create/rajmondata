"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { FleetVehicleFormDialog } from "@/components/fleet/fleet-vehicle-form-dialog";
import { Button } from "@/components/ui/button";
import { movementStatusLabel } from "@/lib/fleet/providers/types";
import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";
import { Loader2, Plus } from "lucide-react";

type Row = {
  id: string;
  name: string;
  licensePlate: string;
  currentDriverName: string | null;
  lastMovementStatus: FleetVehicleMovementStatus;
  lastLocationLabel: string | null;
  lastSpeedKmh: number | null;
  todayDistanceKm: number | null;
  lastPositionAt: string | null;
};

export function FleetVehiclesPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/fleet/vehicles?companyId=${encodeURIComponent(companyId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) setRows(data.vehicles ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!access.canRead) {
    return <p className="p-6 text-muted-foreground">Nemáte oprávnění.</p>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <FleetSubnav />
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold">Vozidla</h1>
        {access.canWrite ? (
          <Button className="gap-2 min-h-[44px]" onClick={() => setWizard(true)}>
            <Plus className="h-4 w-4" /> Přidat vozidlo
          </Button>
        ) : null}
      </div>
      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin mx-auto" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">Vozidlo</th>
                <th className="p-3">SPZ</th>
                <th className="p-3">Řidič</th>
                <th className="p-3">Stav</th>
                <th className="p-3">Poloha</th>
                <th className="p-3">Rychlost</th>
                <th className="p-3">Dnes km</th>
                <th className="p-3">Poslední GPS</th>
                <th className="p-3">Akce</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    Zatím nemáte vozidla. Přidejte vozidlo ručně — po napojení Ecofleet ho spárujete s GPS.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3">{r.licensePlate}</td>
                    <td className="p-3">{r.currentDriverName ?? "—"}</td>
                    <td className="p-3">{movementStatusLabel(r.lastMovementStatus)}</td>
                    <td className="p-3">{r.lastLocationLabel ?? "—"}</td>
                    <td className="p-3">{r.lastSpeedKmh != null ? `${Math.round(r.lastSpeedKmh)} km/h` : "—"}</td>
                    <td className="p-3">{r.todayDistanceKm ?? "—"}</td>
                    <td className="p-3 text-xs">
                      {r.lastPositionAt ? new Date(r.lastPositionAt).toLocaleString("cs-CZ") : "—"}
                    </td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/portal/fleet/vehicles/${r.id}`}>Detail</Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {companyId && user && access.canWrite ? (
        <FleetVehicleFormDialog
          open={wizard}
          onOpenChange={setWizard}
          companyId={companyId}
          getToken={() => user.getIdToken()}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
