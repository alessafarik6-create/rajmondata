"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pause, Play, Download } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LiveSummary = {
  onlineUsers: number;
  loggedInUsers: number;
  activeOrganizations: number;
  activity24h: number;
  lastLoginAt: string | null;
  actionsToday: number;
};

type LiveOrgRow = {
  organizationId: string;
  name: string;
  onlineUsers: number;
  loggedInUsers: number;
  lastActivityAt: string | null;
  lastLoginAt: string | null;
};

type LiveEvent = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  userDisplayName: string | null;
  event: string;
  actionLabelCs: string;
  moduleLabelCs: string;
  createdAt: string | null;
};

export type OrgTableLiveMeta = Record<
  string,
  { onlineUsers: number; lastLoginAt: string | null; lastActivityAt: string | null }
>;

type Props = {
  onLiveMeta?: (meta: OrgTableLiveMeta) => void;
};

function presenceBadge(count: number) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      Online: {count}
    </span>
  );
}

function formatCs(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
}

export function AdminPortalLiveAnalytics({ onLiveMeta }: Props) {
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [liveOrgs, setLiveOrgs] = useState<LiveOrgRow[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [orgFilter, setOrgFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadLive = useCallback(async () => {
    if (paused) return;
    try {
      const [liveRes, evRes] = await Promise.all([
        fetch("/api/superadmin/portal-analytics/live", { credentials: "include", cache: "no-store" }),
        fetch("/api/superadmin/portal-analytics/live/events?limit=60", {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const liveJson = await liveRes.json();
      const evJson = await evRes.json();
      if (liveRes.ok && liveJson.summary) {
        setSummary(liveJson.summary as LiveSummary);
        setLiveOrgs((liveJson.organizations ?? []) as LiveOrgRow[]);
        const meta: OrgTableLiveMeta = {};
        for (const o of (liveJson.organizations ?? []) as LiveOrgRow[]) {
          meta[o.organizationId] = {
            onlineUsers: o.onlineUsers,
            lastLoginAt: o.lastLoginAt,
            lastActivityAt: o.lastActivityAt,
          };
        }
        onLiveMeta?.(meta);
      }
      if (evRes.ok) setEvents((evJson.events ?? []) as LiveEvent[]);
    } finally {
      setLoading(false);
    }
  }, [paused, onLiveMeta]);

  useEffect(() => {
    void loadLive();
    const iv = window.setInterval(() => void loadLive(), 15_000);
    return () => window.clearInterval(iv);
  }, [loadLive]);

  const filteredEvents = useMemo(() => {
    let list = events;
    if (orgFilter) list = list.filter((e) => e.organizationId === orgFilter);
    if (userFilter.trim()) {
      const q = userFilter.trim().toLowerCase();
      list = list.filter((e) => (e.userDisplayName ?? "").toLowerCase().includes(q));
    }
    if (eventFilter) list = list.filter((e) => e.event === eventFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.actionLabelCs.toLowerCase().includes(q) ||
          (e.organizationName ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, orgFilter, userFilter, eventFilter, search]);

  const exportCsv = () => {
    const header = ["čas", "organizace", "uživatel", "akce", "modul"];
    const rows = filteredEvents.map((e) => [
      formatCs(e.createdAt),
      e.organizationName ?? e.organizationId,
      e.userDisplayName ?? "",
      e.actionLabelCs,
      e.moduleLabelCs,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ziva-aktivita-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !summary) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-7 w-7 animate-spin text-orange-600" />
        <span className="sr-only">Načítání živých dat…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(
          [
            { label: "🟢 Právě online", value: summary?.onlineUsers ?? 0 },
            { label: "👥 Přihlášení uživatelé", value: summary?.loggedInUsers ?? 0 },
            { label: "🏢 Aktivní organizace", value: summary?.activeOrganizations ?? 0 },
            { label: "📊 Aktivita za 24 h", value: summary?.activity24h ?? 0 },
            { label: "📈 Akce dnes", value: summary?.actionsToday ?? 0 },
          ] as const
        ).map((c) => (
          <Card key={c.label} className="border-slate-200">
            <CardContent className="pt-4">
              <p className="text-xs text-slate-600">{c.label}</p>
              <p className="text-xl font-bold text-slate-900 tabular-nums">{c.value}</p>
            </CardContent>
          </Card>
        ))}
        <Card className="border-slate-200 sm:col-span-2 xl:col-span-1">
          <CardContent className="pt-4">
            <p className="text-xs text-slate-600">🕒 Poslední přihlášení (systém)</p>
            <p className="text-sm font-semibold text-slate-900">{formatCs(summary?.lastLoginAt)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base">Právě online – organizace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {liveOrgs.filter((o) => o.onlineUsers > 0).length === 0 ? (
            <p className="text-slate-600">Momentálně není online žádný uživatel.</p>
          ) : (
            liveOrgs
              .filter((o) => o.onlineUsers > 0)
              .map((o) => (
                <div
                  key={o.organizationId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{o.name}</p>
                    {presenceBadge(o.onlineUsers)}
                    <p className="text-xs text-slate-600 mt-0.5">
                      Poslední přihlášení: {formatCs(o.lastLoginAt)} · Poslední aktivita:{" "}
                      {formatCs(o.lastActivityAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/admin/analytics/organizations/${o.organizationId}`}>Detail</Link>
                  </Button>
                </div>
              ))
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-base">Živá aktivita uživatelů</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? <Play className="mr-1 h-4 w-4" /> : <Pause className="mr-1 h-4 w-4" />}
              {paused ? "Obnovit živý výpis" : "Pozastavit"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
            <Button type="button" size="sm" onClick={() => void loadLive()}>
              Obnovit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={orgFilter || "__all"} onValueChange={(v) => setOrgFilter(v === "__all" ? "" : v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Organizace" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Všechny organizace</SelectItem>
                {liveOrgs.map((o) => (
                  <SelectItem key={o.organizationId} value={o.organizationId}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Filtr uživatele…"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="h-9"
            />
            <Input
              placeholder="Vyhledávání…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />
          </div>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {filteredEvents.length === 0 ? (
              <li className="text-slate-600 py-4 text-center">
                {events.length === 0
                  ? "Historická data nejsou k dispozici — nové události se zobrazí po aktivitě v portálu."
                  : "Žádná událost neodpovídá filtru."}
              </li>
            ) : (
              filteredEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap gap-x-2 gap-y-0.5 rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5"
                >
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {formatCs(e.createdAt)}
                  </Badge>
                  <span className="font-medium">{e.userDisplayName ?? "Uživatel"}</span>
                  <span className="text-slate-700">{e.actionLabelCs}</span>
                  <span className="text-xs text-slate-500">
                    {e.organizationName ?? e.organizationId} · {e.moduleLabelCs}
                  </span>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
