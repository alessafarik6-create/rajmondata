"use client";

import { useMemo } from "react";
import { endOfDay, startOfDay } from "date-fns";
import { isValidCompanyScheduleEvent } from "@/lib/company-schedule-events";
import { useCompanyScheduleMonthEvents } from "@/hooks/use-company-schedule-month-events";

/**
 * Badge na dlaždici Kalendář — dnešní montáže ve stavu „aktivní“ (planned / inProgress)
 * přiřazené zaměstnanci; u vedení všechny dnešní montáže organizace.
 */
export function useInstallationCalendarBadgeCount(params: {
  companyId: string | undefined;
  employeeId?: string | null;
  /** Owner / admin / manager / accountant — celá firma. */
  isPrivileged?: boolean;
}): { count: number; loading: boolean } {
  const monthAnchor = new Date();
  const { events, loading } = useCompanyScheduleMonthEvents(
    params.companyId,
    monthAnchor
  );

  const count = useMemo(() => {
    const today = new Date();
    const start = startOfDay(today).getTime();
    const end = endOfDay(today).getTime();
    return events.filter((ev) => {
      if (!isValidCompanyScheduleEvent(ev) || ev.kind !== "installation")
        return false;
      const t = ev.at.getTime();
      if (t < start || t > end) return false;
      const st = String(ev.status ?? "");
      if (st === "done" || st === "canceled") return false;
      if (params.isPrivileged) return true;
      const eid = String(params.employeeId ?? "").trim();
      if (!eid) return false;
      const ids = ev.assignedEmployeeIds ?? [];
      return Array.isArray(ids) && ids.includes(eid);
    }).length;
  }, [events, params.isPrivileged, params.employeeId]);

  return { count, loading };
}
