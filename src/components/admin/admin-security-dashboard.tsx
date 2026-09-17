"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

type Incident = {
  id: string;
  severity?: string;
  type?: string;
  route?: string;
  eventCount?: number;
  blocked?: boolean;
  resolvedAt?: unknown;
  lastActivityAt?: unknown;
};

export function AdminSecurityDashboard({ compact }: { compact?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q =
        filter === "unresolved"
          ? "?unresolved=1"
          : filter !== "all"
            ? `?severity=${filter}`
            : "";
      const res = await fetch(`/api/superadmin/security${q}`, {
        credentials: "include",
        cache: "no-store",
      });
      setData(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpi = (data?.kpi ?? {}) as Record<string, number>;
  const status = String(data?.status ?? "ok");
  const series = (Array.isArray(data?.series) ? data!.series : []) as Record<string, unknown>[];
  const incidents = (Array.isArray(data?.incidents) ? data!.incidents : []) as Incident[];

  const resolve = async (id: string) => {
    await fetch("/api/superadmin/security", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId: id }),
    });
    void load();
  };

  const statusLabel =
    status === "critical"
      ? "🔴 Kritické bezpečnostní události"
      : status === "elevated"
        ? "⚠ Zvýšená aktivita"
        : "✓ Bez známek útoku";

  if (compact) {
    return (
      <Card className={status === "critical" ? "border-red-400 bg-red-50/50" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bezpečnost</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{statusLabel}</p>
          <p>
            Podezřelé (24 h): <strong>{kpi.suspiciousToday ?? 0}</strong> · Blokované:{" "}
            <strong>{kpi.blockedToday ?? 0}</strong> · HIGH/CRITICAL otevřené:{" "}
            <strong>{kpi.openHighCritical ?? 0}</strong>
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/security">Bezpečnostní centrum</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <p className="text-lg font-semibold">{statusLabel}</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Podezřelé události dnes", kpi.suspiciousToday],
          ["Blokované požadavky", kpi.blockedToday],
          ["Neúspěšná přihlášení", kpi.failedLoginToday],
          ["Rate-limit zásahy", kpi.rateLimitsToday],
          ["HIGH incidenty", kpi.highToday],
          ["CRITICAL incidenty", kpi.criticalToday],
        ].map(([label, val]) => (
          <Card key={String(label)}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-2xl font-bold">{val ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security events (30 dní)</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line dataKey="events" name="Events" stroke="#ef4444" />
              <Line dataKey="blocked" name="Blocked" stroke="#f97316" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {["all", "HIGH", "CRITICAL", "MEDIUM", "unresolved"].map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incidenty</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-2">Severity</th>
                <th className="p-2">Typ</th>
                <th className="p-2">Endpoint</th>
                <th className="p-2">Počet</th>
                <th className="p-2">Blokováno</th>
                <th className="p-2">Akce</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id} className="border-t">
                  <td className="p-2">
                    <Badge variant={inc.severity === "CRITICAL" ? "destructive" : "secondary"}>
                      {inc.severity}
                    </Badge>
                  </td>
                  <td className="p-2">{inc.type}</td>
                  <td className="p-2 font-mono text-xs">{inc.route}</td>
                  <td className="p-2">{inc.eventCount}</td>
                  <td className="p-2">{inc.blocked ? "Ano" : "Ne"}</td>
                  <td className="p-2">
                    {!inc.resolvedAt ? (
                      <Button size="sm" variant="outline" onClick={() => void resolve(inc.id)}>
                        Vyřešit
                      </Button>
                    ) : (
                      <span className="text-slate-400">Vyřešeno</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
