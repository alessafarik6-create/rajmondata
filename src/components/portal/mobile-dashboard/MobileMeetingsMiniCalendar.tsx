"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CalendarDays, Dot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  useCompany,
  useFirestore,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import { collection, limit, query } from "firebase/firestore";
import { resolveMeetingTitle } from "@/lib/meeting-records-types";

type MeetingRow = {
  id: string;
  title?: string;
  meetingTitle?: string | null;
  meetingAt?: unknown;
  customerName?: string | null;
  jobName?: string | null;
};

function tsToMillis(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "toMillis" in raw && typeof (raw as { toMillis: () => number }).toMillis === "function") {
    try {
      const ms = (raw as { toMillis: () => number }).toMillis();
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null && "toDate" in raw && typeof (raw as { toDate: () => Date }).toDate === "function") {
    try {
      const d = (raw as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    } catch {
      return null;
    }
  }
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.getTime();
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isoDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dowShortCs(d: Date): string {
  const map = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"] as const;
  return map[d.getDay()] ?? "";
}

function formatTimeCs(ms: number): string {
  return new Date(ms).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

export function MobileMeetingsMiniCalendar() {
  const firestore = useFirestore();
  const { companyId } = useCompany();

  const recordsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    // Bez orderBy → žádné composite indexy; řadíme v JS.
    return query(collection(firestore, "companies", companyId, "meetingRecords"), limit(250));
  }, [firestore, companyId]);

  const { data: raw } = useCollection(recordsQuery);

  const meetings = useMemo(() => {
    const list = Array.isArray(raw) ? (raw as MeetingRow[]) : [];
    const now = Date.now();
    const rows = list
      .map((r) => {
        if (!r || typeof r.id !== "string") return null;
        const ms = tsToMillis(r.meetingAt);
        if (!ms) return null;
        return { ...r, ms };
      })
      .filter(Boolean) as Array<MeetingRow & { ms: number }>;
    rows.sort((a, b) => a.ms - b.ms);
    const upcoming = rows.filter((r) => r.ms >= now - 6 * 3600_000).slice(0, 12);
    return upcoming;
  }, [raw]);

  const days = useMemo(() => {
    const out: Array<{ ms: number; isToday: boolean; hasMeeting: boolean }> = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    // 10 dní: 3 před, dnes, 6 po
    const start = new Date(today);
    start.setDate(start.getDate() - 3);
    const meetingDays = new Set(meetings.map((m) => isoDay(m.ms)));
    for (let i = 0; i < 10; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const ms = d.getTime();
      out.push({
        ms,
        isToday: isoDay(ms) === isoDay(Date.now()),
        hasMeeting: meetingDays.has(isoDay(ms)),
      });
    }
    return out;
  }, [meetings]);

  const top = meetings.slice(0, 3);

  return (
    <section aria-label="Schůzky" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-orange-300" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">Schůzky</h2>
        </div>
        <Link href="/portal/meeting-records" className="text-xs font-semibold text-orange-300">
          Záznamy
        </Link>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="-mx-1 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2 px-1">
            {days.map((d) => {
              const dt = new Date(d.ms);
              return (
                <div
                  key={d.ms}
                  className={cn(
                    "w-11 shrink-0 rounded-2xl border px-1.5 py-2 text-center",
                    d.isToday
                      ? "border-orange-500/40 bg-orange-500/15"
                      : "border-white/10 bg-white/5"
                  )}
                >
                  <div className={cn("text-[10px] font-semibold", d.isToday ? "text-orange-200" : "text-slate-300")}>
                    {dowShortCs(dt)}
                  </div>
                  <div className={cn("mt-1 text-sm font-bold tabular-nums", d.isToday ? "text-white" : "text-slate-100")}>
                    {dt.getDate()}
                  </div>
                  <div className="mt-1 flex justify-center">
                    {d.hasMeeting ? (
                      <Dot className={cn("h-5 w-5", d.isToday ? "text-orange-400" : "text-orange-300")} />
                    ) : (
                      <span className="h-5 w-5" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {top.length === 0 ? (
            <p className="text-sm text-slate-300">Žádné naplánované schůzky</p>
          ) : (
            top.map((m) => (
              <Link
                key={m.id}
                href={`/portal/meeting-records/${m.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {resolveMeetingTitle(m) || "Schůzka"}
                  </p>
                  <p className="truncate text-xs text-slate-300">
                    {(m.customerName || m.jobName || "").trim() || "—"}
                  </p>
                </div>
                <Badge className="shrink-0 border border-orange-500/25 bg-orange-500/15 text-orange-200">
                  {formatTimeCs((m as unknown as { ms: number }).ms)}
                </Badge>
              </Link>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

