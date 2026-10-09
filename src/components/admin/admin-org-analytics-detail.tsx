"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft } from "lucide-react";

export function AdminOrgAnalyticsDetail({ organizationId }: { organizationId: string }) {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/superadmin/portal-analytics/companies/${encodeURIComponent(organizationId)}?days=${days}`,
        { credentials: "include", cache: "no-store" }
      );
      const json = await res.json();
      if (res.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }, [organizationId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const org = data?.organization as { name?: string; registeredAt?: string } | undefined;
  const counts = (data?.counts ?? {}) as Record<string, number>;
  const activity = (data?.activity ?? {}) as Record<string, unknown>;
  const periodMetrics = (data?.periodMetrics ?? {}) as Record<string, number>;
  const moduleUsage = useMemo(() => {
    const m = (data?.moduleUsage ?? {}) as Record<string, number>;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [data]);
  const series = (data?.series ?? []) as { date: string; events: number; logins: number }[];

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/analytics">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zpět
          </Link>
        </Button>
        {([7, 30, 90] as const).map((d) => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
            {d} dní
          </Button>
        ))}
      </div>

      <div>
        <h2 className="text-2xl font-bold text-slate-900">{org?.name ?? organizationId}</h2>
        <p className="text-sm text-slate-600">
          Registrace:{" "}
          {org?.registeredAt ? new Date(org.registeredAt).toLocaleString("cs-CZ") : "—"} · Poslední aktivita:{" "}
          {activity.lastActivityAt
            ? new Date(String(activity.lastActivityAt)).toLocaleString("cs-CZ")
            : "—"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Uživatelé", counts.userAccounts],
          ["Zaměstnanci", counts.employees],
          ["Zakázky", counts.jobs],
          ["Poptávky", counts.leads],
          ["Nabídky", counts.offers],
          ["Faktury", counts.invoices],
          ["Dokumenty", counts.documents],
          ["Dokončené zakázky", counts.jobsCompleted],
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
        <CardContent className="flex flex-wrap items-center gap-4 pt-4">
          <Badge>{String(activity.labelCs ?? "—")}</Badge>
          <span>
            Skóre aktivity: <strong>{String(activity.score ?? 0)}</strong> / 100
          </span>
          <span>
            Na uživatele: <strong>{String(activity.scorePerUser ?? 0)}</strong>
          </span>
          <span>Aktivní uživatelé: {String(activity.activeUsers ?? 0)}</span>
          <span>Aktivní dny: {String(activity.activeDays ?? 0)}</span>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(periodMetrics).map(([k, v]) => (
          <Card key={k}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{k}</p>
              <p className="text-xl font-bold">{v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aktivita v čase</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="events" name="Události" stroke="#f97316" />
              <Line type="monotone" dataKey="logins" name="Přihlášení" stroke="#64748b" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Návštěvy modulů</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={moduleUsage}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#f97316" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
