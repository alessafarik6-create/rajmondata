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
import { Input } from "@/components/ui/input";
import { Loader2, Download } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RangeDays = 7 | 30 | 90;

type OrgRow = {
  organizationId: string;
  name: string;
  registeredAt: string | null;
  userAccounts: number;
  employees: number;
  jobs: number;
  leads: number;
  offers: number;
  invoices: number;
  lastActivityAt: string | null;
  logins30d: number;
  activeDays30d: number;
  activeUsers30d: number;
  activityScore: number;
  activityLabelCs: string;
};

export function AdminPortalAnalyticsDashboard() {
  const [days, setDays] = useState<RangeDays>(30);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [alerts, setAlerts] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (from && to) {
      p.set("from", from);
      p.set("to", to);
    } else {
      p.set("days", String(days));
    }
    return p.toString();
  }, [days, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, uRes, aRes] = await Promise.all([
        fetch(`/api/superadmin/portal-analytics/overview?${query}`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`/api/superadmin/portal-analytics/usage?${query}`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`/api/superadmin/portal-analytics/alerts?limit=20`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const oJson = await oRes.json();
      const uJson = await uRes.json();
      const aJson = await aRes.json();
      if (oRes.ok) setOrgs((oJson.organizations ?? []) as OrgRow[]);
      if (uRes.ok) setUsage(uJson);
      if (aRes.ok) setAlerts((aJson.alerts ?? []) as Record<string, unknown>[]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(
      (o) => o.name.toLowerCase().includes(q) || o.organizationId.toLowerCase().includes(q)
    );
  }, [orgs, search]);

  const moduleChart = useMemo(() => {
    const m = (usage?.modules ?? {}) as Record<string, number>;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count }));
  }, [usage]);

  const dailyOrgs = (usage?.dailyActiveOrganizations ?? []) as { date: string; count: number }[];
  const growthSeries = ((usage?.growth as { series?: { date: string; logins: number; visits: number }[] })
    ?.series ?? []) as { date: string; logins: number; visits: number }[];

  const workflows = (usage?.workflows ?? {}) as Record<string, number>;
  const workflowRows = Object.entries(workflows)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (loading && orgs.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {([7, 30, 90] as RangeDays[]).map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d && !from ? "default" : "outline"}
            onClick={() => {
              setFrom("");
              setTo("");
              setDays(d);
            }}
          >
            {d} dní
          </Button>
        ))}
        <Input type="date" className="w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Obnovit
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href="/api/superadmin/portal-analytics/export">
            <Download className="mr-2 h-4 w-4" />
            CSV export
          </a>
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Analytika portálu: agregované sémantické události bez obsahu formulářů. Detailní přístup superadmina se
        audituje. Upozornění generuje cron{" "}
        <code className="rounded bg-slate-100 px-1">/api/cron/portal-analytics-alerts</code>.
      </p>

      {alerts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upozornění</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {alerts.map((a) => (
              <div key={String(a.id)} className="rounded border border-slate-200 p-2">
                {String(a.message ?? "")}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Organizací v přehledu</p>
            <p className="text-2xl font-bold">{orgs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Přihlášení (období)</p>
            <p className="text-2xl font-bold">
              {((usage?.growth as { logins30d?: number })?.logins30d ?? 0) as number}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Nové organizace (30 dní)</p>
            <p className="text-2xl font-bold">
              {((usage?.growth as { newOrganizations30d?: number })?.newOrganizations30d ?? 0) as number}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">Otevření modulů</p>
            <p className="text-2xl font-bold">
              {((usage?.growth as { moduleOpens30d?: number })?.moduleOpens30d ?? 0) as number}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aktivní organizace (denně)</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyOrgs}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Používání modulů</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moduleChart} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#64748b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Růst a aktivita portálu</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={growthSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="logins" name="Přihlášení" stroke="#f97316" />
              <Line type="monotone" dataKey="visits" name="Moduly" stroke="#64748b" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pracovní postupy (agregace)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="space-y-1">
            {workflowRows.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="font-mono text-xs">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Organizace → Analytika</CardTitle>
          <Input
            placeholder="Hledat organizaci…"
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organizace</TableHead>
                <TableHead>Registrace</TableHead>
                <TableHead>Uživ.</TableHead>
                <TableHead>Zam.</TableHead>
                <TableHead>Zakázky</TableHead>
                <TableHead>Poptávky</TableHead>
                <TableHead>Nabídky</TableHead>
                <TableHead>Faktury</TableHead>
                <TableHead>Aktivita</TableHead>
                <TableHead>Skóre</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.organizationId}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {o.registeredAt ? new Date(o.registeredAt).toLocaleDateString("cs-CZ") : "—"}
                  </TableCell>
                  <TableCell>{o.userAccounts}</TableCell>
                  <TableCell>{o.employees}</TableCell>
                  <TableCell>{o.jobs}</TableCell>
                  <TableCell>{o.leads}</TableCell>
                  <TableCell>{o.offers}</TableCell>
                  <TableCell>{o.invoices}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{o.activityLabelCs}</Badge>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {o.activeDays30d} dní · {o.logins30d} přihl.
                    </p>
                  </TableCell>
                  <TableCell>{o.activityScore}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="link" asChild>
                      <Link href={`/admin/analytics/organizations/${o.organizationId}`}>Detail</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
