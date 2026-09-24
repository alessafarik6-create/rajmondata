/**
 * Jediný zdroj pravdy pro organizační kalendář (schůzky + montáže + zaměření).
 * Fyzicky: Firestore `companies/{orgId}/lead_meetings` + `measurements`.
 * Logicky: canonical dataset `calendarEvents` (mapování v buildCompanyScheduleEvents).
 */

export const ORGANIZATION_CALENDAR_MEETINGS_COLLECTION = "lead_meetings";
export const ORGANIZATION_CALENDAR_MEASUREMENTS_COLLECTION = "measurements";

/** Alias pro dokumentaci / logy — stejná data jako lead_meetings. */
export const ORGANIZATION_CALENDAR_EVENTS_COLLECTION =
  ORGANIZATION_CALENDAR_MEETINGS_COLLECTION;

export type OrganizationCalendarAssigneePersist = {
  assignedUserIds: string[];
  assignedEmployeeIds: string[];
  assignedEmployeeNames: string[];
};

const ASSIGNEE_USER_KEYS = [
  "assignedUserIds",
  "assigneeUserIds",
  "participantUserIds",
] as const;

const ASSIGNEE_LEGACY_KEYS = [
  "assignedEmployeeIds",
  "employeeIds",
  "employeeId",
  "assignedTo",
  "assigneeId",
  "workerIds",
  "participants",
] as const;

function collectStringIds(v: unknown, out: Set<string>) {
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = String(x ?? "").trim();
      if (s) out.add(s);
    }
  } else if (typeof v === "string" && v.trim()) {
    out.add(v.trim());
  }
}

/** Načtení přiřazení z Firestore (canonical + legacy). */
export function parseCalendarAssigneesFromFirestore(
  raw: Record<string, unknown> | null | undefined
): { assignedUserIds: string[]; assignedEmployeeIds: string[] } {
  const userIds = new Set<string>();
  const employeeIds = new Set<string>();
  if (!raw || typeof raw !== "object") {
    return { assignedUserIds: [], assignedEmployeeIds: [] };
  }
  for (const key of ASSIGNEE_USER_KEYS) {
    collectStringIds(raw[key], userIds);
  }
  for (const key of ASSIGNEE_LEGACY_KEYS) {
    collectStringIds(raw[key], employeeIds);
  }
  return {
    assignedUserIds: [...userIds],
    assignedEmployeeIds: [...employeeIds],
  };
}

/** Zápis nových událostí — auth uid primárně, employee id pro legacy. */
export function buildCalendarAssigneePersistPayload(
  selectedEmployeeDocIds: string[],
  employeeOptions: Array<{ id: string; name: string; authUserId?: string }>
): OrganizationCalendarAssigneePersist {
  const assignedUserIds = new Set<string>();
  const assignedEmployeeIds = new Set<string>();
  const assignedEmployeeNames: string[] = [];

  for (const empDocId of selectedEmployeeDocIds) {
    const id = String(empDocId ?? "").trim();
    if (!id) continue;
    assignedEmployeeIds.add(id);
    const row = employeeOptions.find((e) => e.id === id);
    if (row?.authUserId) assignedUserIds.add(row.authUserId);
    assignedEmployeeNames.push(row?.name ?? id);
  }

  return {
    assignedUserIds: [...assignedUserIds],
    assignedEmployeeIds: [...assignedEmployeeIds],
    assignedEmployeeNames,
  };
}

/** Mapa employeeDocId → auth uid pro runtime filtr „Moje schůzky“. */
export function buildEmployeeIdToAuthUidMap(
  employeeOptions: Array<{ id: string; authUserId?: string }>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of employeeOptions) {
    const uid = String(e.authUserId ?? "").trim();
    if (uid) m.set(e.id, uid);
  }
  return m;
}

export { useCompanyScheduleMonthEvents as useOrganizationCalendarEvents } from "@/hooks/use-company-schedule-month-events";
export {
  buildCompanyScheduleEvents as mapFirestoreToOrganizationCalendarEvents,
} from "@/lib/company-schedule-events";
