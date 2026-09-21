/**
 * Dynamické menu zaměstnaneckého portálu — stejná pravidla jako firemní sidebar
 * (licence, platform modul, portalModulePermissions READ/WRITE).
 */

import {
  PORTAL_SIDEBAR_MENU_DEFS,
  type PortalSidebarMenuDef,
} from "@/lib/portal-menu-config";
import {
  isPortalMenuItemVisible,
  type PortalMenuVisibilityCtx,
} from "@/lib/portal-menu-visibility";
import {
  canAccessPortalModule,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import { resolveCameraPermissions } from "@/lib/hikvision/camera-access";
import {
  canAccessSchedulePortalRead,
  resolveCalendarPermissions,
} from "@/lib/calendar/calendar-access";
import { isDailyWorkLogEnabled, isWorkLogEnabled } from "@/lib/employee-report-flags";

export type EmployeePortalNavItem = {
  id: string;
  label: string;
  href: string;
};

/** Položky, které zaměstnanec nikdy nevidí v tomto menu (mají jinou cestu nebo jen admin). */
const EXCLUDED_MENU_IDS = new Set<string>([
  "overview",
  "employees",
  "billing",
  "settings",
  "aiCenter",
  "vyuctovani",
  "activity",
]);

/** Zaměstnanecké URL místo plného portálu. */
const EMPLOYEE_HREF_BY_MODULE: Partial<Record<PortalModuleId, string>> = {
  jobs: "/portal/employee/jobs",
  chat: "/portal/employee/messages",
};

const MONEY_MODULE_IDS: PortalModuleId[] = [
  "finance",
  "invoices",
  "documents",
  "vyuctovani",
];

export type ResolveEmployeePortalMenuInput = {
  visibilityCtx: PortalMenuVisibilityCtx;
  permissions: Record<PortalModuleId, PortalAccessLevel>;
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
  /** Lokalizované popisky pro systémové položky */
  labels?: {
    home?: string;
    workReport?: string;
    attendance?: string;
    money?: string;
    notifications?: string;
    profile?: string;
    productionJobs?: string;
  };
};

function employeeCanSeeModule(
  def: PortalSidebarMenuDef,
  input: ResolveEmployeePortalMenuInput
): boolean {
  if (!def.roles.includes("employee")) return false;
  if (EXCLUDED_MENU_IDS.has(def.id)) return false;

  const modId = def.id as PortalModuleId;
  if (!canAccessPortalModule(input.permissions, modId, "read")) return false;

  if (def.id === "cameras" || def.platformModuleCode === "cameras") {
    const cam = resolveCameraPermissions({
      role: input.role,
      globalRoles: input.globalRoles,
      employeeDoc: input.employeeDoc,
      portalModuleCamerasLevel: input.permissions.cameras ?? "none",
    });
    if (!cam.view) return false;
  }

  if (def.id === "schedule") {
    const cal = resolveCalendarPermissions({
      role: input.role,
      globalRoles: input.globalRoles,
      employeeDoc: input.employeeDoc,
      portalModuleScheduleLevel: input.permissions.schedule ?? "none",
    });
    if (!cal.anyView) return false;
  }

  return isPortalMenuItemVisible(def, input.visibilityCtx);
}

export function resolveEmployeePortalMenuItems(
  input: ResolveEmployeePortalMenuInput
): EmployeePortalNavItem[] {
  const L = input.labels ?? {};
  const out: EmployeePortalNavItem[] = [];
  const seenHref = new Set<string>();

  const push = (item: EmployeePortalNavItem) => {
    if (seenHref.has(item.href)) return;
    seenHref.add(item.href);
    out.push(item);
  };

  push({
    id: "_home",
    label: L.home ?? "Hlavní stránka",
    href: "/portal/employee",
  });

  for (const def of PORTAL_SIDEBAR_MENU_DEFS) {
    if (def.type === "system" && def.id !== "chat" && def.id !== "help") continue;
    if (!employeeCanSeeModule(def, input)) continue;

    const modId = def.id as PortalModuleId;
    const href = EMPLOYEE_HREF_BY_MODULE[modId] ?? def.href;
    let label = def.label;
    if (def.id === "labor") label = L.attendance ?? "Docházka";
    push({ id: def.id, label, href });
  }

  const apOk =
    input.visibilityCtx.company &&
    canAccessPortalModule(input.permissions, "labor", "read") &&
    employeeCanSeeModule(
      PORTAL_SIDEBAR_MENU_DEFS.find((d) => d.id === "labor")!,
      input
    );

  if (apOk) {
    const showDaily =
      input.visibilityCtx.employeeRow &&
      isDailyWorkLogEnabled(input.visibilityCtx.employeeRow);
    const showLegacy =
      input.visibilityCtx.employeeRow &&
      !showDaily &&
      isWorkLogEnabled(input.visibilityCtx.employeeRow);
    if (showDaily) {
      push({
        id: "_dailyReports",
        label: L.workReport ?? "Výkaz práce",
        href: "/portal/employee/daily-reports",
      });
    } else if (showLegacy) {
      push({
        id: "_worklogs",
        label: L.workReport ?? "Výkaz práce",
        href: "/portal/employee/worklogs",
      });
    }
  }

  const showMoney = MONEY_MODULE_IDS.some((id) =>
    canAccessPortalModule(input.permissions, id, "read")
  );
  if (showMoney) {
    push({
      id: "_money",
      label: L.money ?? "Peníze",
      href: "/portal/employee/money",
    });
  }

  if (
    canAccessPortalModule(input.permissions, "vyroba", "read") &&
    input.visibilityCtx.company
  ) {
    push({
      id: "_vyrobaJobs",
      label: L.productionJobs ?? "Zakázky ve výrobě",
      href: "/portal/vyroba/zakazky",
    });
  }

  push({
    id: "_notifications",
    label: L.notifications ?? "Oznámení",
    href: "/portal/notifications",
  });

  push({
    id: "_profile",
    label: L.profile ?? "Profil",
    href: "/portal/employee/profile",
  });

  return out;
}

/** Mapování cesty na modul pro guard (včetně zaměstnaneckých větví). */
export function portalModuleIdForEmployeeRoute(pathname: string): PortalModuleId | null {
  const path = String(pathname ?? "").trim() || "/";
  if (path.startsWith("/portal/employee/jobs")) return "jobs";
  if (path.startsWith("/portal/employee/messages")) return "chat";
  if (path.startsWith("/portal/employee/money")) return "finance";
  if (
    path.startsWith("/portal/employee/daily-reports") ||
    path.startsWith("/portal/employee/worklogs") ||
    path.startsWith("/portal/employee/work-log") ||
    path.startsWith("/portal/employee/attendance")
  ) {
    return "labor";
  }
  if (path === "/portal/employee" || path.startsWith("/portal/employee/profile")) {
    return null;
  }
  if (path.startsWith("/portal/notifications")) return null;

  const sorted = [...PORTAL_SIDEBAR_MENU_DEFS].sort(
    (a, b) => b.href.length - a.href.length
  );
  for (const def of sorted) {
    if (path === def.href || path.startsWith(`${def.href}/`)) {
      return def.id as PortalModuleId;
    }
  }
  if (path.startsWith("/portal/offers")) return "offers";
  return null;
}

export function employeeHasReadAccessToPath(
  pathname: string,
  permissions: Record<PortalModuleId, PortalAccessLevel>,
  input?: {
    role?: string;
    globalRoles?: string[] | null;
    employeeDoc?: Record<string, unknown> | null;
  }
): boolean {
  const modId = portalModuleIdForEmployeeRoute(pathname);
  if (!modId) return true;
  if (modId === "schedule") {
    return canAccessSchedulePortalRead({
      role: input?.role ?? "employee",
      globalRoles: input?.globalRoles,
      employeeDoc: input?.employeeDoc,
    });
  }
  return canAccessPortalModule(permissions, modId, "read");
}
