"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Range = "24h" | "7d" | "30d" | "90d";

export function AdminAnalyticsDashboard({ compact }: { compact?: boolean }) {
  const [range, setRange] = useState<Range>("30d");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/superadmin/analytics?range=${range}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok) setData(json);
      else setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpi = (data?.kpi ?? {}) as Record<string, number>;
  const series = (Array.isArray(data?.series) ? data!.series : []) as {
    date: string;
    visits: number;
    pageviews: number;
  }[];
  const topPages = (Array.isArray(data?.topPages) ? data!.topPages : []) as {
    path: string;
    views: number;
    sharePct: number;
  }[];
  const referrers = data?.referrers as Record<string, number> | undefined;
  const devices = data?.devices as Record<string, number> | undefined;
  const funnel = data?.funnel as Record<string, number> | undefined;
  const regSeries = (data?.registrations as { series?: { date: string; count: number }[] })?.series ?? [];

  const refRows = useMemo(
    () =>
      Object.entries(referrers ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
    [referrers]
  );

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Návštěvnost webu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Dnes: <strong>{kpi.visitsToday ?? 0}</strong> · 7 dní: <strong>{kpi.visits7d ?? 0}</strong> · 30 dní:{" "}
            <strong>{kpi.visits30d ?? 0}</strong>
          </p>
          <p>
            Nové organizace (30 dní): <strong>{kpi.registrations30d ?? 0}</strong> · Konverze:{" "}
            <strong>{kpi.conversionPct30d ?? 0} %</strong>
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/analytics">Otevřít analytiku</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(["24h", "7d", "30d", "90d"] as Range[]).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={range === r ? "default" : "outline"}
            onClick={() => setRange(r)}
          >
            {r === "24h" ? "24 hodin" : r === "7d" ? "7 dní" : r === "30d" ? "30 dní" : "90 dní"}
          </Button>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Provider: agregovaná first-party analytika (bez Google Analytics / Vercel Analytics v projektu). Realtime není
        k dispozici.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Návštěvy dnes", kpi.visitsToday],
          ["Návštěvy 7 dní", kpi.visits7d],
          ["Návštěvy 30 dní", kpi.visits30d],
          ["Unikátní návštěvníci (30 dní)", kpi.uniqueVisitors30d],
          ["Zobrazení stránek (30 dní)", kpi.pageviews30d],
          ["Registrace dnes", kpi.registrationsToday],
          ["Registrace 7 dní", kpi.registrations7d],
          ["Registrace 30 dní", kpi.registrations30d],
          ["Konverze návštěva → registrace", `${kpi.conversionPct30d ?? 0} %`],
        ].map(([label, val]) => (
          <Card key={String(label)}>
            <CardContent className="pt-4">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-2xl font-bold text-slate-900">{val ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Návštěvnost webu</CardTitle>
        </CardHeader>
        <CardContent className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="visits" name="Návštěvy" stroke="#f97316" strokeWidth={2} />
              <Line type="monotone" dataKey="pageviews" name="Pageviews" stroke="#64748b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nové organizace (z databáze)</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" name="Registrace" fill="#f97316" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nejnavštěvovanější stránky</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2">Stránka</th>
                  <th className="pb-2">Zobrazení</th>
                  <th className="pb-2">Podíl</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((p) => (
                  <tr key={p.path} className="border-t border-slate-100">
                    <td className="py-2 font-mono text-xs">{p.path}</td>
                    <td className="py-2">{p.views}</td>
                    <td className="py-2">{p.sharePct} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Zdroje návštěvnosti</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {refRows.map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="font-medium">{v}</span>
                </li>
              ))}
            </ul>
            {devices ? (
              <div className="mt-4 border-t pt-4 text-sm">
                <p className="font-medium text-slate-700">Zařízení</p>
                {Object.entries(devices).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {funnel ? (
        <Card>
          <CardHeader>
            <CardTitle>Konverzní funnel (události)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.entries(funnel)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
