/**
 * Admin UI + náhled: stejné vyhodnocení jako runtime (`resolveEffectivePortalPermissions`).
 */

import {
  resolveCalendarPermissions,
  resolveCalendarSubLevels,
  type CalendarSubPermissionKey,
} from "@/lib/calendar/calendar-access";
import {
  employeePortalRoleLabel,
  parseEmployeePortalRole,
  type EmployeePortalRoleId,
} from "@/lib/employee-portal-role";
import { userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import {
  ALL_PORTAL_MODULE_IDS,
  applyManagerPermissionCaps,
  emptyPermissionMap,
  initialPortalPermissionLevelsForEmployee,
  isPortalModulePermissionsMaterialized,
  PORTAL_PERMISSION_MODULES,
  resolveEffectivePortalPermissions,
  portalModuleLevelsFromFirestoreRecord,
  portalModulePermissionsRecordFromLevelMap,
  sanitizePortalPermissionsForOrgRole,
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

/** Přesně uložená matice z Firestore (chybějící klíče = none). */
export function storedPortalPermissionLevelsFromEmployeeDoc(
  employeeDoc: Record<string, unknown> | null | undefined
): Record<PortalModuleId, PortalAccessLevel> {
  const out = emptyPermissionMap();
  const raw = employeeDoc?.portalModulePermissions;
  if (!raw || typeof raw !== "object") return out;
  for (const id of ALL_PORTAL_MODULE_IDS) {
    const v = String((raw as Record<string, unknown>)[id] ?? "none").trim().toLowerCase();
    out[id] = v === "read" || v === "write" || v === "none" ? v : "none";
  }
  return out;
}

/** Úroveň pro editor — materializovaná matice = uložené hodnoty; jinak legacy + dílčí override. */
export function portalPermissionLevelsForAdminEditor(
  employeeDoc: Record<string, unknown> | null | undefined,
  portalRole: EmployeePortalRoleId
): Record<PortalModuleId, PortalAccessLevel> {
  if (portalRole === "orgAdmin") {
    return initialPortalPermissionLevelsForEmployee(employeeDoc, portalRole);
  }

  const stored = storedPortalPermissionLevelsFromEmployeeDoc(employeeDoc);
  const raw = employeeDoc?.portalModulePermissions;
  const hasStoredKeys =
    raw != null && typeof raw === "object" && Object.keys(raw as object).length > 0;

  if (isPortalModulePermissionsMaterialized(employeeDoc)) {
    return portalRole === "manager" ? applyManagerPermissionCaps(stored) : stored;
  }

  const userRole = userPortalRoleForEmployeeDocRole(portalRole);
  const effective = resolveEffectivePortalPermissions({
    role: userRole,
    employeeDoc,
  });

  if (!hasStoredKeys) {
    return effective;
  }

  const merged = { ...effective };
  for (const id of ALL_PORTAL_MODULE_IDS) {
    if (Object.prototype.hasOwnProperty.call(raw as object, id)) {
      merged[id] = stored[id] ?? "none";
    }
  }
  return portalRole === "manager" ? applyManagerPermissionCaps(merged) : merged;
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
  /** Hodnota v editoru „Přístup k modulům“ (matice). */
  editorLevel: PortalAccessLevel;
  /** Výchozí úroveň jen z uložené organizační role (bez individuální matice). */
  roleDefaultLevel: PortalAccessLevel;
  effectiveLevel: PortalAccessLevel;
  limitReason: PortalPermissionLimitReason | null;
};

export type EmployeePortalAccessSnapshot = {
  /** Role uložená v employees.role — autorita pro běh portálu. */
  savedOrgRole: EmployeePortalRoleId;
  /** Role zobrazená v editoru (může být neuložená). */
  editorOrgRole: EmployeePortalRoleId;
  savedOrgRoleLabel: string;
  editorOrgRoleLabel: string;
  rolesDiffer: boolean;
  moduleRows: PortalModuleAccessSnapshotRow[];
  calendar: {
    meetings: {
      editor: PortalAccessLevel;
      roleDefault: PortalAccessLevel;
      effective: PortalAccessLevel;
    };
    installations: {
      editor: PortalAccessLevel;
      roleDefault: PortalAccessLevel;
      effective: PortalAccessLevel;
    };
  };
  materialized: boolean;
};

function employeeDocForRoleDefaultsOnly(
  employeeDoc: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!employeeDoc) return null;
  return {
    ...employeeDoc,
    portalModulePermissions: {},
    portalModulePermissionsMaterialized: false,
  };
}

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
  editorOrgRole: EmployeePortalRoleId
): EmployeePortalAccessSnapshot {
  const savedOrgRole = parseEmployeePortalRole(employeeDoc?.role);
  const savedUserRole = userPortalRoleForEmployeeDocRole(savedOrgRole);

  const editorLevels = portalPermissionLevelsForAdminEditor(employeeDoc, editorOrgRole);
  const effective = resolveEffectivePortalPermissions({
    role: savedUserRole,
    employeeDoc,
  });
  const roleDefaults = resolveEffectivePortalPermissions({
    role: savedUserRole,
    employeeDoc: employeeDocForRoleDefaultsOnly(employeeDoc),
  });

  const editorCal = calendarLevelsForAdminEditor(employeeDoc, editorOrgRole, editorLevels);
  const effectiveCal = resolveCalendarPermissions({
    role: savedUserRole,
    employeeDoc,
    portalModuleScheduleLevel: effective.schedule ?? "none",
  });
  const roleDefaultCal = resolveCalendarPermissions({
    role: savedUserRole,
    employeeDoc: employeeDocForRoleDefaultsOnly(employeeDoc),
    portalModuleScheduleLevel: roleDefaults.schedule ?? "none",
  });

  const materialized = isPortalModulePermissionsMaterialized(employeeDoc);

  const moduleRows: PortalModuleAccessSnapshotRow[] = PORTAL_PERMISSION_MODULES.filter(
    (m) => m.id !== "schedule"
  ).map((mod) => {
    const id = mod.id as PortalModuleId;
    const editorLevel = editorLevels[id] ?? "none";
    const roleDefaultLevel = roleDefaults[id] ?? "none";
    const effectiveLevel = effective[id] ?? "none";
    let limitReason: PortalPermissionLimitReason | null = null;
    if (editorLevel !== effectiveLevel) {
      if (roleDefaultLevel !== "none" && editorLevel === "none" && effectiveLevel !== "none") {
        limitReason = "legacy_preset";
      } else if (roleDefaultLevel !== editorLevel && effectiveLevel === roleDefaultLevel) {
        limitReason = "legacy_preset";
      } else {
        limitReason = materialized ? "org_role_cap" : "legacy_preset";
      }
    } else if (materialized) {
      limitReason = "stored";
    } else if (effectiveLevel !== "none") {
      limitReason = "legacy_preset";
    }
    return {
      moduleId: id,
      label: mod.label,
      editorLevel,
      roleDefaultLevel,
      effectiveLevel,
      limitReason,
    };
  });

  return {
    savedOrgRole,
    editorOrgRole,
    savedOrgRoleLabel: employeePortalRoleLabel(savedOrgRole),
    editorOrgRoleLabel: employeePortalRoleLabel(editorOrgRole),
    rolesDiffer: savedOrgRole !== editorOrgRole,
    moduleRows,
    calendar: {
      meetings: {
        editor: editorCal.meetings,
        roleDefault: roleDefaultCal.meetings.level,
        effective: effectiveCal.meetings.level,
      },
      installations: {
        editor: editorCal.installations,
        roleDefault: roleDefaultCal.installations.level,
        effective: effectiveCal.installations.level,
      },
    },
    materialized,
  };
}

/** Porovnání odpovědi API po uložení oprávnění — úspěch jen při shodě s požadavkem. */
export function verifyEmployeeOrgPermissionsSaveResponse(input: {
  requestedRole: EmployeePortalRoleId;
  requestedPortalModulePermissions: Record<string, string>;
  responseRole: unknown;
  responsePortalModulePermissions: Record<string, string> | null | undefined;
}): string | null {
  const savedRole = parseEmployeePortalRole(input.responseRole);
  if (savedRole !== input.requestedRole) {
    return `Role se v databázi neuložila (očekáváno ${input.requestedRole}, uloženo ${savedRole}).`;
  }
  const savedRaw = input.responsePortalModulePermissions;
  if (!savedRaw || typeof savedRaw !== "object") {
    return "Chybí uložená matice oprávnění v odpovědi serveru.";
  }
  const requestedLevels = portalModuleLevelsFromFirestoreRecord(
    input.requestedPortalModulePermissions
  );
  const expectedRecord = portalModulePermissionsRecordFromLevelMap(
    sanitizePortalPermissionsForOrgRole(requestedLevels, input.requestedRole)
  );
  const savedLevels = portalModuleLevelsFromFirestoreRecord(savedRaw);
  const expectedLevels = portalModuleLevelsFromFirestoreRecord(expectedRecord);
  for (const id of ALL_PORTAL_MODULE_IDS) {
    if ((savedLevels[id] ?? "none") !== (expectedLevels[id] ?? "none")) {
      return `Oprávnění modulu „${id}“ se neuložilo správně.`;
    }
  }
  return null;
}
