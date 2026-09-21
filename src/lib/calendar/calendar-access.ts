import {
  resolveEffectivePortalPermissions,
  type PortalAccessLevel,
} from "@/lib/portal-permissions";
import { normalizeCompanyRole } from "@/lib/company-privilege";

export type CalendarSubPermissionKey = "meetings" | "installations";

export type CalendarPermissionsDoc = Partial<
  Record<CalendarSubPermissionKey, PortalAccessLevel>
>;

export type CalendarSubAccess = {
  level: PortalAccessLevel;
  view: boolean;
  write: boolean;
};

export type CalendarPermissionsResolved = {
  meetings: CalendarSubAccess;
  installations: CalendarSubAccess;
  /** Alespoň jeden typ události s READ/WRITE. */
  anyView: boolean;
  anyWrite: boolean;
};

function parseLevel(raw: unknown): PortalAccessLevel {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "read" || v === "write" || v === "none") return v;
  return "none";
}

function subAccess(level: PortalAccessLevel): CalendarSubAccess {
  return {
    level,
    view: level === "read" || level === "write",
    write: level === "write",
  };
}

export function parseCalendarPermissionsDoc(
  employeeDoc: Record<string, unknown> | null | undefined
): CalendarPermissionsDoc {
  const raw = employeeDoc?.calendarPermissions;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    meetings: parseLevel(o.meetings),
    installations: parseLevel(o.installations),
  };
}

/** Odvození podoprávnění z legacy `portalModulePermissions.schedule`. */
export function calendarPermissionsFromScheduleLevel(
  scheduleLevel: PortalAccessLevel
): CalendarPermissionsDoc {
  if (scheduleLevel === "none") {
    return { meetings: "none", installations: "none" };
  }
  return { meetings: scheduleLevel, installations: scheduleLevel };
}

export function resolveCalendarSubLevels(input: {
  employeeDoc?: Record<string, unknown> | null;
  portalModuleScheduleLevel?: PortalAccessLevel;
}): Record<CalendarSubPermissionKey, PortalAccessLevel> {
  const explicit = parseCalendarPermissionsDoc(input.employeeDoc);
  const hasExplicit =
    explicit.meetings != null ||
    explicit.installations != null ||
    (input.employeeDoc?.calendarPermissions != null &&
      typeof input.employeeDoc.calendarPermissions === "object");

  const scheduleFallback =
    input.portalModuleScheduleLevel ??
    resolveEffectivePortalPermissions({
      role: "employee",
      employeeDoc: input.employeeDoc,
    }).schedule ??
    "none";

  if (hasExplicit) {
    const fallback = calendarPermissionsFromScheduleLevel(scheduleFallback);
    return {
      meetings: explicit.meetings ?? fallback.meetings ?? "none",
      installations: explicit.installations ?? fallback.installations ?? "none",
    };
  }

  const fromSchedule = calendarPermissionsFromScheduleLevel(scheduleFallback);
  return {
    meetings: fromSchedule.meetings ?? "none",
    installations: fromSchedule.installations ?? "none",
  };
}

function isCalendarPrivilegedRole(role: string, globalRoles?: string[] | null): boolean {
  const r = normalizeCompanyRole(role);
  if (r === "owner" || r === "admin" || r === "manager" || r === "accountant") return true;
  if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) return true;
  return false;
}

export function resolveCalendarPermissions(input: {
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
  portalModuleScheduleLevel?: PortalAccessLevel;
}): CalendarPermissionsResolved {
  if (isCalendarPrivilegedRole(input.role, input.globalRoles)) {
    const full = subAccess("write");
    return {
      meetings: full,
      installations: full,
      anyView: true,
      anyWrite: true,
    };
  }

  const scheduleLevel =
    input.portalModuleScheduleLevel ??
    resolveEffectivePortalPermissions({
      role: input.role,
      globalRoles: input.globalRoles,
      employeeDoc: input.employeeDoc,
    }).schedule ??
    "none";

  const subs = resolveCalendarSubLevels({
    employeeDoc: input.employeeDoc,
    portalModuleScheduleLevel: scheduleLevel,
  });

  const meetings = subAccess(subs.meetings);
  const installations = subAccess(subs.installations);
  return {
    meetings,
    installations,
    anyView: meetings.view || installations.view,
    anyWrite: meetings.write || installations.write,
  };
}

/** Agregovaná úroveň modulu Kalendář pro `portalModulePermissions.schedule`. */
export function aggregateScheduleModuleLevel(
  doc: CalendarPermissionsDoc
): PortalAccessLevel {
  const rank = (l: PortalAccessLevel) => (l === "write" ? 2 : l === "read" ? 1 : 0);
  const m = parseLevel(doc.meetings);
  const i = parseLevel(doc.installations);
  const max = Math.max(rank(m), rank(i));
  if (max >= 2) return "write";
  if (max >= 1) return "read";
  return "none";
}

export function normalizeCalendarPermissionsForFirestore(
  doc: CalendarPermissionsDoc | null | undefined
): Record<string, string> | null {
  if (!doc || typeof doc !== "object") return null;
  const meetings = parseLevel(doc.meetings);
  const installations = parseLevel(doc.installations);
  if (meetings === "none" && installations === "none") return null;
  const out: Record<string, string> = {};
  if (meetings !== "none") out.meetings = meetings;
  if (installations !== "none") out.installations = installations;
  return Object.keys(out).length > 0 ? out : null;
}

export function initialCalendarPermissionsForEmployee(
  employeeDoc: Record<string, unknown> | null | undefined,
  scheduleLevel: PortalAccessLevel
): Record<CalendarSubPermissionKey, PortalAccessLevel> {
  return resolveCalendarSubLevels({
    employeeDoc,
    portalModuleScheduleLevel: scheduleLevel,
  });
}

export function canAccessSchedulePortalRead(input: {
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
}): boolean {
  return resolveCalendarPermissions(input).anyView;
}

export function calendarEventKindFromDoc(data: Record<string, unknown>): "meeting" | "installation" {
  const t = String(data.calendarEventType ?? data.eventType ?? "").trim();
  if (t === "installation") return "installation";
  return "meeting";
}

export function employeeCanViewCalendarEventKind(
  kind: "meeting" | "installation" | "measurement",
  cal: CalendarPermissionsResolved
): boolean {
  if (kind === "measurement") {
    return cal.meetings.view || cal.installations.view;
  }
  if (kind === "installation") return cal.installations.view;
  return cal.meetings.view;
}

export function employeeCanWriteCalendarEventKind(
  kind: "meeting" | "installation",
  cal: CalendarPermissionsResolved
): boolean {
  if (kind === "installation") return cal.installations.write;
  return cal.meetings.write;
}
