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
import {
  AdminPortalLiveAnalytics,
  type OrgTableLiveMeta,
} from "@/components/admin/admin-portal-live-analytics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [liveMeta, setLiveMeta] = useState<OrgTableLiveMeta>({});
  const [activityFilter, setActivityFilter] = useState<
    "all" | "active_today" | "inactive_7" | "inactive_30" | "never"
  >("all");
  const [page, setPage] = useState(0);
  const pageSize = 25;

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
    let list = orgs;
    if (q) {
      list = list.filter(
        (o) => o.name.toLowerCase().includes(q) || o.organizationId.toLowerCase().includes(q)
      );
    }
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (activityFilter === "active_today") {
      list = list.filter((o) => {
        const live = liveMeta[o.organizationId];
        if (live?.onlineUsers) return true;
        const t = o.lastActivityAt ? Date.parse(o.lastActivityAt) : NaN;
        return Number.isFinite(t) && now - t < dayMs;
      });
    } else if (activityFilter === "inactive_7") {
      list = list.filter((o) => {
        const t = o.lastActivityAt ? Date.parse(o.lastActivityAt) : NaN;
        return !Number.isFinite(t) || now - t > 7 * dayMs;
      });
    } else if (activityFilter === "inactive_30") {
      list = list.filter((o) => {
        const t = o.lastActivityAt ? Date.parse(o.lastActivityAt) : NaN;
        return !Number.isFinite(t) || now - t > 30 * dayMs;
      });
    } else if (activityFilter === "never") {
      list = list.filter((o) => !o.lastActivityAt && (o.jobs ?? 0) + (o.leads ?? 0) === 0);
    }
    return list;
  }, [orgs, search, activityFilter, liveMeta]);

  const paged = useMemo(() => {
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

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

      <AdminPortalLiveAnalytics onLiveMeta={setLiveMeta} />

      <p className="text-xs text-slate-500">
        Analytika portálu: agregované sémantické události bez obsahu formulářů. Živá data se obnovují každých 15 s
        (polling). Detailní přístup superadmina se audituje. Upozornění generuje cron{" "}
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
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Hledat organizaci…"
              className="max-w-xs"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <Select
              value={activityFilter}
              onValueChange={(v) => {
                setActivityFilter(v as typeof activityFilter);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[220px] h-9">
                <SelectValue placeholder="Filtr aktivity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny organizace</SelectItem>
                <SelectItem value="active_today">Aktivní dnes</SelectItem>
                <SelectItem value="inactive_7">Neaktivní &gt; 7 dní</SelectItem>
                <SelectItem value="inactive_30">Neaktivní &gt; 30 dní</SelectItem>
                <SelectItem value="never">Bez použití</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 md:hidden">
            {paged.map((o) => {
              const live = liveMeta[o.organizationId];
              return (
                <div key={o.organizationId} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-semibold">{o.name}</p>
                  {live?.onlineUsers ? (
                    <p className="text-emerald-800 text-xs">🟢 Online: {live.onlineUsers}</p>
                  ) : null}
                  <p className="text-xs text-slate-600">
                    Poslední aktivita:{" "}
                    {o.lastActivityAt
                      ? new Date(o.lastActivityAt).toLocaleString("cs-CZ")
                      : "Historická data nejsou k dispozici"}
                  </p>
                  <Button size="sm" className="mt-2" variant="outline" asChild>
                    <Link href={`/admin/analytics/organizations/${o.organizationId}`}>Detail</Link>
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organizace</TableHead>
                  <TableHead>Registrace</TableHead>
                  <TableHead>Uživ.</TableHead>
                  <TableHead className="whitespace-nowrap">Online</TableHead>
                  <TableHead className="whitespace-nowrap">Posl. přihl.</TableHead>
                  <TableHead className="whitespace-nowrap">Posl. aktivita</TableHead>
                  <TableHead>Zam.</TableHead>
                  <TableHead>Zak.</TableHead>
                  <TableHead>Popt.</TableHead>
                  <TableHead>Nab.</TableHead>
                  <TableHead>Fakt.</TableHead>
                  <TableHead>Skóre</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((o) => {
                  const live = liveMeta[o.organizationId];
                  return (
                    <TableRow key={o.organizationId}>
                      <TableCell className="font-medium min-w-[10rem]">
                        <div>{o.name}</div>
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          {o.activityLabelCs}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {o.registeredAt ? new Date(o.registeredAt).toLocaleDateString("cs-CZ") : "—"}
                      </TableCell>
                      <TableCell>{o.userAccounts}</TableCell>
                      <TableCell>{live?.onlineUsers ?? 0}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {live?.lastLoginAt
                          ? new Date(live.lastLoginAt).toLocaleString("cs-CZ", {
                              timeZone: "Europe/Prague",
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {(live?.lastActivityAt ?? o.lastActivityAt)
                          ? new Date(String(live?.lastActivityAt ?? o.lastActivityAt)).toLocaleString(
                              "cs-CZ",
                              { timeZone: "Europe/Prague" }
                            )
                          : "—"}
                      </TableCell>
                      <TableCell>{o.employees}</TableCell>
                      <TableCell>{o.jobs}</TableCell>
                      <TableCell>{o.leads}</TableCell>
                      <TableCell>{o.offers}</TableCell>
                      <TableCell>{o.invoices}</TableCell>
                      <TableCell>{o.activityScore}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="link" asChild>
                          <Link href={`/admin/analytics/organizations/${o.organizationId}`}>Detail</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              Zobrazeno {paged.length} / {filtered.length}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Předchozí
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={(page + 1) * pageSize >= filtered.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Další
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
