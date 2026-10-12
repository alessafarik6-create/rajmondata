"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, ChevronRight } from "lucide-react";
import type { LeadReminderRecord } from "@/lib/leads/lead-reminder-types";
import { formatRemindAtPrague, pragueTodayYmd, pragueTomorrowYmd } from "@/lib/leads/lead-reminder-datetime";
import { leadReminderOpenUrl } from "@/lib/leads/lead-reminder-types";
import { ymdInLeadsTimezone } from "@/lib/leads/lead-received-date";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LeadReminderFilter =
  | "today"
  | "tomorrow"
  | "week"
  | "missed"
  | "done"
  | "all";

const FILTERS: { key: LeadReminderFilter; label: string }[] = [
  { key: "today", label: "Dnes" },
  { key: "tomorrow", label: "Zítra" },
  { key: "week", label: "Tento týden" },
  { key: "missed", label: "Zmeškané" },
  { key: "done", label: "Vyřízené" },
  { key: "all", label: "Všechny moje" },
];

function matchesFilter(r: LeadReminderRecord, filter: LeadReminderFilter, now: Date): boolean {
  const ymd = ymdInLeadsTimezone(new Date(r.remindAt));
  const today = pragueTodayYmd(now);
  const tomorrow = pragueTomorrowYmd(now);
  const dueMs = new Date(r.remindAt).getTime();

  if (filter === "done") return r.status === "done";
  if (r.status !== "active") return false;
  if (filter === "missed") return dueMs < now.getTime();
  if (filter === "today") return ymd === today;
  if (filter === "tomorrow") return ymd === tomorrow;
  if (filter === "week") {
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return dueMs >= now.getTime() - 60_000 && dueMs <= end.getTime();
  }
  return true;
}

type Props = {
  reminders: LeadReminderRecord[];
  className?: string;
};

export function LeadRemindersOverviewPanel({ reminders, className }: Props) {
  const [filter, setFilter] = useState<LeadReminderFilter>("today");
  const now = useMemo(() => new Date(), [reminders.length, filter]);

  const filtered = useMemo(
    () =>
      [...reminders]
        .filter((r) => matchesFilter(r, filter, now))
        .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime()),
    [reminders, filter, now]
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <AlarmClock className="h-5 w-5 text-amber-700" />
        <h2 className="text-base font-semibold text-slate-900">Připomínky u poptávek</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-600">V tomto filtru nemáte žádné připomínky.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id}>
              <Link
                href={leadReminderOpenUrl(r.leadKey)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{r.customerName}</p>
                  <p className="text-xs text-slate-700 truncate">{r.inquiryTitle}</p>
                  <p className="text-xs text-slate-600">
                    {formatRemindAtPrague(new Date(r.remindAt))}
                    {r.assignedDisplayName ? ` · ${r.assignedDisplayName}` : ""}
                    {r.status === "done" ? " · vyřízeno" : r.status === "active" && new Date(r.remindAt) < now
                      ? " · zmeškané"
                      : ""}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
