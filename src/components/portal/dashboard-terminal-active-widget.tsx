"use client";

import React, { useMemo } from "react";
import { UserCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildEmployeeMap,
  attendanceRowMatchesEmployee,
} from "@/lib/attendance-overview-compute";
import {
  inferAttendanceClockStateForDay,
  type AttendanceRow,
} from "@/lib/employee-attendance";
import {
  buildTerminalActiveSegmentMapFromRows,
  getTerminalActiveSegmentForEmployee,
  terminalActiveSegmentDashboardLabel,
} from "@/lib/terminal-active-segment";
import { DASHBOARD_WIDGET_LIST_SCROLL_CLASS } from "@/lib/dashboard-widget-list-styles";
import { DashboardCompactCard } from "@/components/portal/dashboard-compact-card";
import { cn } from "@/lib/utils";

type EmployeeDoc = Record<string, unknown> & { id?: string };

export function DashboardTerminalActiveWidget({
  employees,
  attendanceTodayRows,
  openWorkSegmentRows,
  loading,
  layout = "default",
}: {
  employees: EmployeeDoc[] | undefined;
  attendanceTodayRows: AttendanceRow[] | null | undefined;
  /** Otevřené úseky z `work_segments` (dnes, `closed === false`) — realtime z Firestore. */
  openWorkSegmentRows?: Array<Record<string, unknown> & { id: string }> | null;
  loading?: boolean;
  layout?: "default" | "compact";
}) {
  const active = useMemo(() => {
    const raw = Array.isArray(employees) ? employees : [];
    const todayRows = Array.isArray(attendanceTodayRows) ? attendanceTodayRows : [];
    const segmentRows = Array.isArray(openWorkSegmentRows) ? openWorkSegmentRows : [];
    const segmentMap = buildTerminalActiveSegmentMapFromRows(segmentRows);
    const empMap = buildEmployeeMap(raw as Record<string, unknown>[]);
    const rows: {
      employeeKey: string;
      name: string;
      checkInLabel: string;
      segmentLine: string | null;
    }[] = [];

    for (const emp of empMap.values()) {
      const dayRows = todayRows.filter((r) =>
        attendanceRowMatchesEmployee(r, emp.id, emp.authUserId)
      );
      if (dayRows.length === 0) continue;
      const st = inferAttendanceClockStateForDay(dayRows);
      if (st.state !== "in") continue;
      const seg = getTerminalActiveSegmentForEmployee(segmentMap, emp);
      const segmentLine = terminalActiveSegmentDashboardLabel(seg);
      rows.push({
        employeeKey: emp.id,
        name: emp.displayName,
        checkInLabel: st.lastCheckIn.toLocaleTimeString("cs-CZ", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        segmentLine,
      });
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    return rows;
  }, [employees, attendanceTodayRows, openWorkSegmentRows]);

  const empTotal = Array.isArray(employees) ? employees.length : 0;
  const inCount = active.length;
  const outCount = Math.max(0, empTotal - inCount);

  if (layout === "compact") {
    return (
      <DashboardCompactCard
        title="V práci"
        icon={<UserCheck className="h-4 w-4 text-emerald-600" />}
        accentClass="border-l-emerald-500"
        href="/portal/labor/dochazka"
        footerLabel="Docházka"
      >
        {loading ? (
          <p className="text-xs text-muted-foreground">Načítání…</p>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-x-3 text-muted-foreground">
              <span>
                V práci: <strong className="text-foreground">{inCount}</strong>
              </span>
              <span>
                Mimo: <strong className="text-foreground">{outCount}</strong>
              </span>
            </div>
            <ul className="space-y-1">
              {active.slice(0, 4).map((item) => (
                <li key={item.employeeKey} className="truncate rounded border border-border/50 px-2 py-0.5">
                  {item.name}
                  <span className="text-muted-foreground"> · od {item.checkInLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DashboardCompactCard>
    );
  }

  return (
    <Card className="flex h-full w-full flex-col border-border bg-card shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <UserCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          V práci (terminál)
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          Zaměstnanci s posledním příchodem na terminálu bez odhlášení dnes. U každého je aktuální
          tarif nebo zakázka z otevřeného úseku práce.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-3 pt-0">
        {loading ? (
          <div className="flex min-h-[4rem] flex-1 items-center justify-center">
            <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Momentálně není nikdo přihlášen na terminálu.
          </p>
        ) : (
          <ul
            className={cn(
              "space-y-2 pr-1",
              DASHBOARD_WIDGET_LIST_SCROLL_CLASS
            )}
          >
            {active.map((item) => (
              <li
                key={item.employeeKey}
                className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40 sm:mt-2"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{item.name}</span>
                      {item.segmentLine ? (
                        <span
                          className="mt-0.5 block max-w-full truncate text-[11px] leading-snug text-muted-foreground"
                          title={item.segmentLine}
                        >
                          {item.segmentLine}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 self-end tabular-nums text-xs text-muted-foreground sm:self-start sm:pt-0.5">
                    od {item.checkInLabel}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
