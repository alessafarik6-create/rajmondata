"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { FleetSubnav } from "@/components/fleet/fleet-subnav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function FleetStatisticsPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("fleet");
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/fleet/statistics?companyId=${encodeURIComponent(companyId)}&period=${period}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, access.canRead, period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!access.canRead) return <p className="p-6 text-muted-foreground">Nemáte oprávnění.</p>;

  const totals = (data?.totals ?? {}) as Record<string, number>;
  const byVehicle = (data?.byVehicle ?? []) as { label: string; km: number; trips: number }[];
  const byDriver = (data?.byDriver ?? []) as { name: string; km: number; trips: number }[];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <FleetSubnav />
      <h1 className="text-2xl font-semibold">Statistiky</h1>
      <div className="flex flex-wrap gap-2">
        {(["day", "week", "month"] as const).map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {p === "day" ? "Den" : p === "week" ? "Týden" : "Měsíc"}
          </Button>
        ))}
      </div>
      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin" />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Počet jízd", totals.trips ?? 0],
              ["Kilometry", Math.round(totals.km ?? 0)],
              ["Doba jízdy (min)", totals.driveMinutes ?? 0],
              ["Doba stání (min)", totals.idleMinutes ?? 0],
            ].map(([l, v]) => (
              <Card key={String(l)}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs text-muted-foreground">{l}</CardTitle>
                </CardHeader>
                <CardContent className="text-xl font-semibold">{v}</CardContent>
              </Card>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Km podle vozidla</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {byVehicle.length === 0 ? (
                  <p className="text-muted-foreground">Bez dat v období.</p>
                ) : (
                  byVehicle.map((r) => (
                    <p key={r.label}>
                      {r.label}: <strong>{Math.round(r.km)} km</strong> ({r.trips} jízd)
                    </p>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Km podle řidiče</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {byDriver.length === 0 ? (
                  <p className="text-muted-foreground">Bez dat v období.</p>
                ) : (
                  byDriver.map((r) => (
                    <p key={r.name}>
                      {r.name}: <strong>{Math.round(r.km)} km</strong> ({r.trips} jízd)
                    </p>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
