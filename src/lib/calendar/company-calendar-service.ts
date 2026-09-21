/**
 * Jednotný zdroj filtrování kalendáře — admin i zaměstnanec načítají stejná data
 * (`useCompanyScheduleMonthEvents` + `buildCompanyScheduleEvents`), rozdíl je jen ve filtru.
 */

import type { CompanyScheduleCalendarEvent } from "@/lib/company-schedule-events";
import { isValidCompanyScheduleEvent } from "@/lib/company-schedule-events";
import {
  employeeCanViewCalendarEventKind,
  type CalendarPermissionsResolved,
} from "@/lib/calendar/calendar-access";

export type CompanyCalendarViewer = {
  /** true = jen události pro tohoto zaměstnance (přiřazení / autor / broadcast). */
  restrictToEmployeeScope: boolean;
  viewerUid: string;
  viewerEmployeeId: string;
  isManagement: boolean;
  calendarAccess: CalendarPermissionsResolved;
};

const ASSIGNEE_FIELD_KEYS = [
  "assignedEmployeeIds",
  "employeeIds",
  "employeeId",
  "assignedTo",
  "assigneeId",
  "workerIds",
  "participants",
] as const;

/** Normalizace přiřazení z Firestore (historické i nové struktury). */
export function getAssignedEmployeeIdsFromFirestore(
  raw: Record<string, unknown> | null | undefined
): string[] {
  if (!raw || typeof raw !== "object") return [];
  const out = new Set<string>();

  for (const key of ASSIGNEE_FIELD_KEYS) {
    const v = raw[key];
    if (Array.isArray(v)) {
      for (const x of v) {
        const s = String(x ?? "").trim();
        if (s) out.add(s);
      }
    } else if (typeof v === "string" && v.trim()) {
      out.add(v.trim());
    }
  }

  return [...out];
}

export function getAssignedEmployeeIdsFromEvent(
  ev: CompanyScheduleCalendarEvent
): string[] {
  const ids = ev.assignedEmployeeIds ?? [];
  return Array.isArray(ids) ? ids.map((x) => String(x).trim()).filter(Boolean) : [];
}

export function calendarEventAssignsToViewer(
  ev: CompanyScheduleCalendarEvent,
  viewerEmployeeId: string,
  viewerUid: string
): boolean {
  const eid = viewerEmployeeId.trim();
  const uid = viewerUid.trim();
  const assigned = getAssignedEmployeeIdsFromEvent(ev);
  if (eid && assigned.includes(eid)) return true;
  if (uid && assigned.includes(uid)) return true;
  return false;
}

function employeeScopeAllowsEvent(
  ev: CompanyScheduleCalendarEvent,
  viewer: CompanyCalendarViewer
): boolean {
  const uid = viewer.viewerUid.trim();
  const eid = viewer.viewerEmployeeId.trim();

  if (ev.kind === "meeting") {
    if (ev.sentToAllEmployees) return true;
    if (calendarEventAssignsToViewer(ev, eid, uid)) return true;
    if (uid && ev.createdByUid === uid) return true;
    return false;
  }

  if (ev.kind === "installation") {
    return calendarEventAssignsToViewer(ev, eid, uid);
  }

  if (ev.kind === "measurement") {
    if (calendarEventAssignsToViewer(ev, eid, uid)) return true;
    if (uid && ev.createdByUid === uid) return true;
    return false;
  }

  return false;
}

/** Oprávnění typu + (u zaměstnance) přiřazení. */
export function filterCompanyCalendarEventsForViewer(
  events: CompanyScheduleCalendarEvent[],
  viewer: CompanyCalendarViewer
): CompanyScheduleCalendarEvent[] {
  const afterPermission = events.filter((ev) => {
    if (!isValidCompanyScheduleEvent(ev)) return false;
    if (viewer.isManagement) return true;
    return employeeCanViewCalendarEventKind(ev.kind, viewer.calendarAccess);
  });

  if (!viewer.restrictToEmployeeScope || viewer.isManagement) {
    return afterPermission;
  }

  if (!viewer.viewerUid.trim()) return [];

  const matched = afterPermission.filter((ev) => employeeScopeAllowsEvent(ev, viewer));

  if (process.env.NODE_ENV === "development") {
    console.log("[calendar debug]", {
      userId: viewer.viewerUid,
      employeeId: viewer.viewerEmployeeId,
      restrictToEmployeeScope: viewer.restrictToEmployeeScope,
      permissions: {
        meetings: viewer.calendarAccess.meetings.level,
        installations: viewer.calendarAccess.installations.level,
      },
      rawEvents: events.length,
      afterPermission: afterPermission.length,
      matchedEvents: matched.length,
    });
  }

  return matched;
}

/** Rozsah měsíce pro dotaz na `measurements.scheduledAt` (ISO řetězce). */
export function pragueMonthScheduledAtIsoRange(month: Date): {
  startIso: string;
  endIso: string;
} {
  const y = month.getFullYear();
  const m = month.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, "0");
  return {
    startIso: `${y}-${mm}-01T00:00:00`,
    endIso: `${y}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999`,
  };
}
