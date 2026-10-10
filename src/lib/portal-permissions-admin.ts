/**
 * Admin UI + náhled: stejné vyhodnocení jako runtime (`resolveEffectivePortalPermissions`).
 */

import {
  resolveCalendarPermissions,
  resolveCalendarSubLevels,
  type CalendarSubPermissionKey,
} from "@/lib/calendar/calendar-access";
import type { EmployeePortalRoleId } from "@/lib/employee-portal-role";
import { userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import {
  ALL_PORTAL_MODULE_IDS,
  emptyPermissionMap,
  initialPortalPermissionLevelsForEmployee,
  isPortalModulePermissionsMaterialized,
  PORTAL_PERMISSION_MODULES,
  resolveEffectivePortalPermissions,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";

export function buildNewEmployeePermissionPreset(): Record<PortalModuleId, PortalAccessLevel> {
  return emptyPermissionMap();
}

export function defaultCalendarLevelsForNewEmployee(): Record<
  CalendarSubPermissionKey,
  PortalAccessLevel
> {
  return { meetings: "none", installations: "none" };
}

/** Úroveň pro editor — u nematerializovaných účtů odpovídá efektivnímu přístupu (legacy). */
export function portalPermissionLevelsForAdminEditor(
  employeeDoc: Record<string, unknown> | null | undefined,
  portalRole: EmployeePortalRoleId
): Record<PortalModuleId, PortalAccessLevel> {
  if (portalRole === "orgAdmin") {
    return initialPortalPermissionLevelsForEmployee(employeeDoc, portalRole);
  }
  if (isPortalModulePermissionsMaterialized(employeeDoc)) {
    return initialPortalPermissionLevelsForEmployee(employeeDoc, portalRole);
  }
  const userRole = userPortalRoleForEmployeeDocRole(portalRole);
  return resolveEffectivePortalPermissions({
    role: userRole,
    employeeDoc,
  });
}

/** Kalendář v admin UI — stejné podsekce jako u přihlášeného zaměstnance. */
export function calendarLevelsForAdminEditor(
  employeeDoc: Record<string, unknown> | null | undefined,
  portalRole: EmployeePortalRoleId,
  moduleLevels: Record<PortalModuleId, PortalAccessLevel>
): Record<CalendarSubPermissionKey, PortalAccessLevel> {
  const userRole = userPortalRoleForEmployeeDocRole(portalRole);
  const cal = resolveCalendarPermissions({
    role: userRole,
    employeeDoc,
    portalModuleScheduleLevel: moduleLevels.schedule ?? "none",
  });
  return {
    meetings: cal.meetings.level,
    installations: cal.installations.level,
  };
}

export type PortalPermissionLimitReason =
  | "stored"
  | "legacy_preset"
  | "org_role_cap"
  | "license"
  | "platform_module";

export type PortalModuleAccessSnapshotRow = {
  moduleId: PortalModuleId;
  label: string;
  storedLevel: PortalAccessLevel;
  effectiveLevel: PortalAccessLevel;
  limitReason: PortalPermissionLimitReason | null;
};

export type EmployeePortalAccessSnapshot = {
  moduleRows: PortalModuleAccessSnapshotRow[];
  calendar: {
    meetings: { stored: PortalAccessLevel; effective: PortalAccessLevel };
    installations: { stored: PortalAccessLevel; effective: PortalAccessLevel };
  };
  materialized: boolean;
};

function storedLevelsFromDoc(
  employeeDoc: Record<string, unknown> | null | undefined
): Record<PortalModuleId, PortalAccessLevel> {
  const out = emptyPermissionMap();
  const raw = employeeDoc?.portalModulePermissions;
  if (!raw || typeof raw !== "object") return out;
  for (const id of ALL_PORTAL_MODULE_IDS) {
    const v = String((raw as Record<string, unknown>)[id] ?? "").trim().toLowerCase();
    if (v === "read" || v === "write" || v === "none") out[id] = v;
  }
  return out;
}

export function buildEmployeePortalAccessSnapshot(
  employeeDoc: Record<string, unknown> | null | undefined,
  portalRole: EmployeePortalRoleId
): EmployeePortalAccessSnapshot {
  const userRole = userPortalRoleForEmployeeDocRole(portalRole);
  const stored = storedLevelsFromDoc(employeeDoc);
  const editorLevels = portalPermissionLevelsForAdminEditor(employeeDoc, portalRole);
  const effective = resolveEffectivePortalPermissions({
    role: userRole,
    employeeDoc,
  });

  const storedCal = resolveCalendarSubLevels({
    employeeDoc,
    portalModuleScheduleLevel: stored.schedule ?? "none",
  });
  const effectiveCal = resolveCalendarPermissions({
    role: userRole,
    employeeDoc,
    portalModuleScheduleLevel: effective.schedule ?? "none",
  });

  const materialized = isPortalModulePermissionsMaterialized(employeeDoc);
  const legacy = !materialized;

  const moduleRows: PortalModuleAccessSnapshotRow[] = PORTAL_PERMISSION_MODULES.filter(
    (m) => m.id !== "schedule"
  ).map((mod) => {
    const id = mod.id as PortalModuleId;
    let storedLevel = stored[id] ?? "none";
    if (!materialized && !employeeDoc?.portalModulePermissions) {
      storedLevel = "none";
    }
    const effectiveLevel = effective[id] ?? "none";
    let limitReason: PortalPermissionLimitReason | null = null;
    if (storedLevel !== effectiveLevel) {
      if (legacy && effectiveLevel !== "none") limitReason = "legacy_preset";
      else limitReason = "org_role_cap";
    } else if (legacy && effectiveLevel !== "none") {
      limitReason = "legacy_preset";
    } else if (materialized) {
      limitReason = "stored";
    }
    return {
      moduleId: id,
      label: mod.label,
      storedLevel: editorLevels[id] ?? "none",
      effectiveLevel,
      limitReason,
    };
  });

  return {
    moduleRows,
    calendar: {
      meetings: {
        stored: storedCal.meetings,
        effective: effectiveCal.meetings.level,
      },
      installations: {
        stored: storedCal.installations,
        effective: effectiveCal.installations.level,
      },
    },
    materialized,
  };
}
