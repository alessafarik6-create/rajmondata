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
import { parseCalendarAssigneesFromFirestore } from "@/lib/calendar/organization-calendar-repository";
import { ORGANIZATION_CALENDAR_EVENTS_COLLECTION } from "@/lib/calendar/organization-calendar-repository";

export type CompanyCalendarViewer = {
  /** true = jen události pro tohoto zaměstnance (přiřazení / autor / broadcast). */
  restrictToEmployeeScope: boolean;
  viewerUid: string;
  viewerEmployeeId: string;
  isManagement: boolean;
  calendarAccess: CalendarPermissionsResolved;
  organizationId?: string;
};

/** @deprecated Použij parseCalendarAssigneesFromFirestore — zachováno pro importy. */
export function getAssignedEmployeeIdsFromFirestore(
  raw: Record<string, unknown> | null | undefined
): string[] {
  return parseCalendarAssigneesFromFirestore(raw).assignedEmployeeIds;
}

export function getAssignedEmployeeIdsFromEvent(
  ev: CompanyScheduleCalendarEvent
): string[] {
  const ids = ev.assignedEmployeeIds ?? [];
  return Array.isArray(ids) ? ids.map((x) => String(x).trim()).filter(Boolean) : [];
}

export function getAssignedUserIdsFromEvent(
  ev: CompanyScheduleCalendarEvent,
  employeeIdToAuthUid?: Map<string, string>
): string[] {
  const out = new Set<string>();
  for (const uid of ev.assignedUserIds ?? []) {
    const s = String(uid ?? "").trim();
    if (s) out.add(s);
  }
  for (const id of getAssignedEmployeeIdsFromEvent(ev)) {
    const mapped = employeeIdToAuthUid?.get(id);
    if (mapped) out.add(mapped);
    else out.add(id);
  }
  return [...out];
}

export function calendarEventAssignsToViewer(
  ev: CompanyScheduleCalendarEvent,
  viewerEmployeeId: string,
  viewerUid: string,
  employeeIdToAuthUid?: Map<string, string>
): boolean {
  const eid = viewerEmployeeId.trim();
  const uid = viewerUid.trim();
  const userIds = getAssignedUserIdsFromEvent(ev, employeeIdToAuthUid);
  if (uid && userIds.includes(uid)) return true;
  const legacy = getAssignedEmployeeIdsFromEvent(ev);
  if (eid && legacy.includes(eid)) return true;
  if (uid && legacy.includes(uid)) return true;
  return false;
}

function employeeScopeAllowsEvent(
  ev: CompanyScheduleCalendarEvent,
  viewer: CompanyCalendarViewer,
  employeeIdToAuthUid?: Map<string, string>
): boolean {
  const uid = viewer.viewerUid.trim();

  if (ev.kind === "meeting") {
    if (ev.sentToAllEmployees || ev.isOrganizationWide) return true;
    if (calendarEventAssignsToViewer(ev, viewer.viewerEmployeeId, uid, employeeIdToAuthUid)) {
      return true;
    }
    if (uid && ev.createdByUid === uid) return true;
    return false;
  }

  if (ev.kind === "installation") {
    return calendarEventAssignsToViewer(
      ev,
      viewer.viewerEmployeeId,
      uid,
      employeeIdToAuthUid
    );
  }

  if (ev.kind === "measurement") {
    if (calendarEventAssignsToViewer(ev, viewer.viewerEmployeeId, uid, employeeIdToAuthUid)) {
      return true;
    }
    if (uid && ev.createdByUid === uid) return true;
    return false;
  }

  return false;
}

/** Oprávnění typu + (u zaměstnance) přiřazení. */
export function filterCompanyCalendarEventsForViewer(
  events: CompanyScheduleCalendarEvent[],
  viewer: CompanyCalendarViewer,
  employeeIdToAuthUid?: Map<string, string>
): CompanyScheduleCalendarEvent[] {
  const afterPermission = events.filter((ev) => {
    if (!isValidCompanyScheduleEvent(ev)) return false;
    if (viewer.isManagement) return true;
    return employeeCanViewCalendarEventKind(ev.kind, viewer.calendarAccess);
  });

  if (!viewer.restrictToEmployeeScope || viewer.isManagement) {
    if (process.env.NODE_ENV === "development") {
      console.log("[CALENDAR] source collection:", ORGANIZATION_CALENDAR_EVENTS_COLLECTION);
      console.log("[CALENDAR] organizationId:", viewer.organizationId ?? "—");
      console.log("[CALENDAR] currentUserId:", viewer.viewerUid);
      console.log("[CALENDAR] loaded event count:", events.length);
      console.log("[CALENDAR] filtered my event count:", afterPermission.length);
    }
    return afterPermission;
  }

  if (!viewer.viewerUid.trim()) return [];

  const matched = afterPermission.filter((ev) =>
    employeeScopeAllowsEvent(ev, viewer, employeeIdToAuthUid)
  );

  if (process.env.NODE_ENV === "development") {
    console.log("[CALENDAR] source collection:", ORGANIZATION_CALENDAR_EVENTS_COLLECTION);
    console.log("[CALENDAR] organizationId:", viewer.organizationId ?? "—");
    console.log("[CALENDAR] currentUserId:", viewer.viewerUid);
    console.log("[CALENDAR] assignedUserIds (sample):", matched[0]?.assignedUserIds ?? "—");
    console.log("[CALENDAR] loaded event count:", events.length);
    console.log("[CALENDAR] after permission count:", afterPermission.length);
    console.log("[CALENDAR] filtered my event count:", matched.length);
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
