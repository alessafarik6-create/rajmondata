/**
 * Centrální oprávnění firemního portálu: NONE / READ / WRITE po modulech (sidebar).
 * Zdroj pravdy pro menu: PORTAL_SIDEBAR_MENU_DEFS (`portal-menu-config.ts`).
 */

import { PORTAL_SIDEBAR_MENU_DEFS } from "@/lib/portal-menu-config";
import {
  parseEmployeePortalModules,
  type EmployeePortalModules,
} from "@/lib/employee-portal-modules";
import { normalizeCompanyRole } from "@/lib/company-privilege";

export type PortalAccessLevel = "none" | "read" | "write";

/** Id modulu = `PortalSidebarMenuDef.id`. */
export type PortalModuleId = (typeof PORTAL_SIDEBAR_MENU_DEFS)[number]["id"];

export type PortalModulePermissionMap = Partial<Record<PortalModuleId, PortalAccessLevel>>;

export type PortalPermissionModuleMeta = {
  id: PortalModuleId;
  label: string;
  href: string;
  sensitive?: boolean;
};

const SENSITIVE_MODULE_IDS = new Set<PortalModuleId>([
  "employees",
  "labor",
  "finance",
  "invoices",
  "billing",
  "settings",
  "activity",
  "fleet",
]);

export const PORTAL_PERMISSION_MODULES: readonly PortalPermissionModuleMeta[] =
  PORTAL_SIDEBAR_MENU_DEFS.map((d) => ({
    id: d.id as PortalModuleId,
    label: d.label,
    href: d.href,
    sensitive: SENSITIVE_MODULE_IDS.has(d.id as PortalModuleId),
  }));

export const ALL_PORTAL_MODULE_IDS: readonly PortalModuleId[] =
  PORTAL_PERMISSION_MODULES.map((m) => m.id);

export type PortalPermissionPresetId = "accountant" | "employee" | "read_all" | "none_all";

/** Výchozí READ pro roli Účetní (business preset — prakticky celý portál kromě správy). */
export function buildAccountantPermissionPreset(): Record<PortalModuleId, PortalAccessLevel> {
  const out = emptyPermissionMap();
  const readIds: PortalModuleId[] = [
    "overview",
    "employees",
    "labor",
    "customers",
    "jobs",
    "leads",
    "emails",
    "offers",
    "productCatalogs",
    "customerChats",
    "meetingRecords",
    "fleet",
    "finance",
    "invoices",
    "documents",
    "sklad",
    "vyroba",
    "reports",
    "activity",
    "vyuctovani",
    "chat",
    "help",
  ];
  for (const id of readIds) out[id] = "read";
  out.settings = "none";
  out.billing = "none";
  out.aiCenter = "none";
  return out;
}

/** Migrace: zaměstnanec — WRITE tam, kde dnes role `employee` v menu + hrubé přepínače modulů. */
export function buildLegacyEmployeePermissionPreset(
  employeeDoc: Record<string, unknown> | null | undefined
): Record<PortalModuleId, PortalAccessLevel> {
  const out = emptyPermissionMap();
  const coarse = parseEmployeePortalModules(employeeDoc);
  const row = employeeDoc ?? {};

  for (const def of PORTAL_SIDEBAR_MENU_DEFS) {
    const id = def.id as PortalModuleId;
    if (!def.roles.includes("employee")) {
      out[id] = "none";
      continue;
    }
    if (!legacyEmployeeModuleCoarseAllowed(id, coarse, row)) {
      out[id] = "none";
      continue;
    }
    out[id] = "write";
  }
  return out;
}

/** Manager — WRITE na moduly viditelné roli manager v menu (zpětná kompatibilita). */
export function buildLegacyManagerPermissionPreset(): Record<PortalModuleId, PortalAccessLevel> {
  const out = emptyPermissionMap();
  for (const def of PORTAL_SIDEBAR_MENU_DEFS) {
    const id = def.id as PortalModuleId;
    out[id] = def.roles.includes("manager") ? "write" : "none";
  }
  return out;
}

function legacyEmployeeModuleCoarseAllowed(
  moduleId: PortalModuleId,
  coarse: EmployeePortalModules,
  row: Record<string, unknown>
): boolean {
  const zakazkyIds: PortalModuleId[] = [
    "jobs",
    "leads",
    "customers",
    "offers",
    "productCatalogs",
    "customerChats",
    "meetingRecords",
  ];
  if (zakazkyIds.includes(moduleId)) {
    if (!coarse.zakazky) return false;
    if (moduleId === "meetingRecords") {
      return row.canAccessMeetingNotes === true;
    }
    return true;
  }
  if (moduleId === "sklad") {
    return row.canAccessWarehouse === true;
  }
  if (moduleId === "vyroba") {
    return row.canAccessProduction === true;
  }
  if (moduleId === "labor") {
    return coarse.dochazka;
  }
  if (moduleId === "chat") {
    return coarse.zpravy;
  }
  if (moduleId === "overview" || moduleId === "help" || moduleId === "settings") {
    return true;
  }
  return true;
}

export function emptyPermissionMap(): Record<PortalModuleId, PortalAccessLevel> {
  const out = {} as Record<PortalModuleId, PortalAccessLevel>;
  for (const id of ALL_PORTAL_MODULE_IDS) {
    out[id] = "none";
  }
  return out;
}

export function parsePortalModulePermissionsFromEmployee(
  employeeDoc: Record<string, unknown> | null | undefined
): PortalModulePermissionMap {
  const raw = employeeDoc?.portalModulePermissions;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PortalModulePermissionMap = {};
  for (const id of ALL_PORTAL_MODULE_IDS) {
    const v = String(o[id] ?? "").trim().toLowerCase();
    if (v === "read" || v === "write" || v === "none") {
      out[id] = v;
    }
  }
  return out;
}

export function portalAccessLevelSatisfies(
  level: PortalAccessLevel,
  required: "read" | "write"
): boolean {
  if (required === "read") return level === "read" || level === "write";
  return level === "write";
}

export function canAccessPortalModule(
  permissions: Record<PortalModuleId, PortalAccessLevel>,
  moduleId: PortalModuleId,
  required: "read" | "write"
): boolean {
  return portalAccessLevelSatisfies(permissions[moduleId] ?? "none", required);
}

export type ResolvePortalPermissionsInput = {
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
};

/** Owner / super_admin — vždy WRITE; účetní — max READ; admin/manager — WRITE (legacy). */
export function resolveEffectivePortalPermissions(
  input: ResolvePortalPermissionsInput
): Record<PortalModuleId, PortalAccessLevel> {
  const role = normalizeCompanyRole(input.role);
  const globalRoles = Array.isArray(input.globalRoles) ? input.globalRoles : [];

  if (globalRoles.includes("super_admin") || role === "owner") {
    return fullWritePermissionMap();
  }

  if (role === "admin") {
    const map = fullWritePermissionMap();
    map.billing = "write";
    return map;
  }

  const overrides = parsePortalModulePermissionsFromEmployee(input.employeeDoc ?? null);

  if (role === "accountant") {
    const base = buildAccountantPermissionPreset();
    return applyOverridesCapReadOnly(base, overrides);
  }

  if (role === "manager") {
    const base = buildLegacyManagerPermissionPreset();
    return applyOverrides(base, overrides, "write");
  }

  if (role === "employee") {
    const base = buildLegacyEmployeePermissionPreset(input.employeeDoc);
    if (Object.keys(overrides).length > 0) {
      return applyOverrides(base, overrides, "write");
    }
    return base;
  }

  return emptyPermissionMap();
}

function fullWritePermissionMap(): Record<PortalModuleId, PortalAccessLevel> {
  const out = emptyPermissionMap();
  for (const id of ALL_PORTAL_MODULE_IDS) {
    out[id] = "write";
  }
  return out;
}

export function buildOrgAdminPermissionPreset(): Record<PortalModuleId, PortalAccessLevel> {
  return fullWritePermissionMap();
}

function applyOverrides(
  base: Record<PortalModuleId, PortalAccessLevel>,
  overrides: PortalModulePermissionMap,
  max: PortalAccessLevel
): Record<PortalModuleId, PortalAccessLevel> {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides) as [PortalModuleId, PortalAccessLevel][]) {
    if (!ALL_PORTAL_MODULE_IDS.includes(k)) continue;
    out[k] = capAccessLevel(v, max);
  }
  return out;
}

function applyOverridesCapReadOnly(
  base: Record<PortalModuleId, PortalAccessLevel>,
  overrides: PortalModulePermissionMap
): Record<PortalModuleId, PortalAccessLevel> {
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides) as [PortalModuleId, PortalAccessLevel][]) {
    if (!ALL_PORTAL_MODULE_IDS.includes(k)) continue;
    if (v === "write") out[k] = "read";
    else if (v === "read" || v === "none") out[k] = v;
  }
  return out;
}

function capAccessLevel(v: PortalAccessLevel, max: PortalAccessLevel): PortalAccessLevel {
  const rank = { none: 0, read: 1, write: 2 };
  return rank[v] <= rank[max] ? v : max;
}

export function roleIsReadOnlyPortal(role: string): boolean {
  return normalizeCompanyRole(role) === "accountant";
}

export function portalPermissionsAllowMutation(
  permissions: Record<PortalModuleId, PortalAccessLevel>,
  moduleId: PortalModuleId,
  role: string
): boolean {
  if (roleIsReadOnlyPortal(role)) return false;
  return canAccessPortalModule(permissions, moduleId, "write");
}

/** Longest-prefix match cesty portálu na modul. */
export function portalModuleIdFromPathname(pathname: string): PortalModuleId | null {
  const path = String(pathname ?? "").trim() || "/";
  if (!path.startsWith("/portal")) return null;
  if (path.startsWith("/portal/employee")) return null;

  const sorted = [...PORTAL_SIDEBAR_MENU_DEFS].sort(
    (a, b) => b.href.length - a.href.length
  );
  for (const def of sorted) {
    if (path === def.href || path.startsWith(`${def.href}/`)) {
      return def.id as PortalModuleId;
    }
  }
  if (path.startsWith("/portal/offers")) return "offers";
  if (path.startsWith("/portal/tasks")) return "overview";
  return "overview";
}

export function applyPermissionPreset(
  preset: PortalPermissionPresetId
): Record<PortalModuleId, PortalAccessLevel> {
  switch (preset) {
    case "accountant":
      return buildAccountantPermissionPreset();
    case "employee":
      return buildLegacyEmployeePermissionPreset(null);
    case "read_all": {
      const m = emptyPermissionMap();
      for (const id of ALL_PORTAL_MODULE_IDS) m[id] = "read";
      return m;
    }
    case "none_all":
      return emptyPermissionMap();
    default:
      return emptyPermissionMap();
  }
}

export function serializePortalModulePermissionsForFirestore(
  map: Record<PortalModuleId, PortalAccessLevel>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ALL_PORTAL_MODULE_IDS) {
    const v = map[id] ?? "none";
    if (v !== "none") out[id] = v;
  }
  return out;
}

/** Zpětná kompatibilita: hrubé přepínače zaměstnaneckého portálu. */
export function portalPermissionsToLegacyEmployeeModules(
  map: Record<PortalModuleId, PortalAccessLevel>
): EmployeePortalModules {
  const level = (id: PortalModuleId) => map[id] ?? "none";
  const anyAccess = (ids: PortalModuleId[]) =>
    ids.some((id) => level(id) !== "none");
  return {
    zakazky: anyAccess([
      "jobs",
      "leads",
      "customers",
      "offers",
      "productCatalogs",
      "customerChats",
      "meetingRecords",
    ]),
    penize: anyAccess(["finance", "invoices", "documents", "billing", "vyuctovani"]),
    zpravy: level("chat") !== "none",
    dochazka: level("labor") !== "none",
  };
}

export function legacyAccessFlagsFromPortalPermissions(
  map: Record<PortalModuleId, PortalAccessLevel>
): {
  canAccessWarehouse: boolean;
  canAccessProduction: boolean;
  canAccessMeetingNotes: boolean;
} {
  const level = (id: PortalModuleId) => map[id] ?? "none";
  return {
    canAccessWarehouse: level("sklad") !== "none",
    canAccessProduction: level("vyroba") !== "none",
    canAccessMeetingNotes: level("meetingRecords") !== "none",
  };
}

/** Výchozí mapa pro UI podle role v dokumentu zaměstnance. */
export function initialPortalPermissionLevelsForEmployee(
  employeeDoc: Record<string, unknown> | null | undefined,
  portalRole: import("@/lib/employee-portal-role").EmployeePortalRoleId
): Record<PortalModuleId, PortalAccessLevel> {
  const raw = employeeDoc?.portalModulePermissions;
  if (raw && typeof raw === "object" && Object.keys(raw as object).length > 0) {
    const m = emptyPermissionMap();
    for (const id of ALL_PORTAL_MODULE_IDS) {
      const v = String((raw as Record<string, unknown>)[id] ?? "").trim().toLowerCase();
      if (v === "read" || v === "write" || v === "none") m[id] = v;
    }
    return m;
  }
  if (portalRole === "orgAdmin") {
    return fullWritePermissionMap();
  }
  if (portalRole === "accountant") {
    return buildAccountantPermissionPreset();
  }
  return buildLegacyEmployeePermissionPreset(employeeDoc);
}

/** Modul správy oprávnění — jen owner/admin. */
export function canManagePortalPermissions(role: string, globalRoles?: string[] | null): boolean {
  const r = normalizeCompanyRole(role);
  if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) return true;
  return r === "owner" || r === "admin";
}
