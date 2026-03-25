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

type EmployeeDoc = Record<string, unknown> & { id?: string };

export function DashboardTerminalActiveWidget({
  employees,
  attendanceTodayRows,
  loading,
}: {
  employees: EmployeeDoc[] | undefined;
  attendanceTodayRows: AttendanceRow[] | null | undefined;
  loading?: boolean;
}) {
  const active = useMemo(() => {
    const raw = Array.isArray(employees) ? employees : [];
    const todayRows = Array.isArray(attendanceTodayRows) ? attendanceTodayRows : [];
    const empMap = buildEmployeeMap(raw as Record<string, unknown>[]);
    const rows: { name: string; checkInLabel: string }[] = [];

    for (const emp of empMap.values()) {
      const dayRows = todayRows.filter((r) =>
        attendanceRowMatchesEmployee(r, emp.id, emp.authUserId)
      );
      if (dayRows.length === 0) continue;
      const st = inferAttendanceClockStateForDay(dayRows);
      if (st.state !== "in") continue;
      rows.push({
        name: emp.displayName,
        checkInLabel: st.lastCheckIn.toLocaleTimeString("cs-CZ", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    return rows;
  }, [employees, attendanceTodayRows]);

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <UserCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          V práci (terminál)
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          Zaměstnanci s posledním příchodem na terminálu bez odhlášení dnes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading ? (
          <div className="flex min-h-[4rem] items-center justify-center">
            <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Momentálně není nikdo přihlášen na terminálu.
          </p>
        ) : (
          <ul className="max-h-[280px] space-y-2 overflow-y-auto pr-1 [-webkit-overflow-scrolling:touch]">
            {active.map((item, idx) => (
              <li
                key={`${item.name}-${item.checkInLabel}-${idx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/40"
                    aria-hidden
                  />
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {item.name}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  od {item.checkInLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
