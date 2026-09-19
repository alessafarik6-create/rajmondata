import type { LucideIcon } from "lucide-react";
import { PORTAL_SIDEBAR_MENU_DEFS } from "@/lib/portal-menu-config";
import { portalMenuIcon } from "@/lib/portal-menu-icons";
import {
  isPortalMenuItemVisible,
  type PortalMenuVisibilityCtx,
} from "@/lib/portal-menu-visibility";
import {
  canAccessPortalModule,
  resolveEffectivePortalPermissions,
  type PortalModuleId,
} from "@/lib/portal-permissions";

export type MobileHomeTile = {
  key: string;
  title: string;
  href?: string;
  openSchedule?: boolean;
  hideDescription?: boolean;
  Icon: LucideIcon;
};

/** Sidebar id nebo href už pokryté pevnými dlaždicemi (aby nebyly duplicity). */
const COVERED_SIDEBAR_IDS = new Set<string>([
  "overview",
  "employees",
  "jobs",
  "finance",
  "chat",
  "customers",
  "invoices",
  "documents",
  "sklad",
  "vyroba",
  "labor",
  "fleet",
]);

/**
 * Pevné dlaždice zachovávající stávající mobilní UX (docházka, výplaty, …).
 * Pořadí = pořadí v mřížce.
 */
function legacyMobileTiles(role: string): MobileHomeTile[] {
  const hoursHref = role === "employee" ? "/portal/employee/worklogs" : "/portal/labor/vykazy";
  return [
    {
      key: "calendar",
      title: "Kalendář",
      openSchedule: true,
      hideDescription: true,
      Icon: portalMenuIcon("calendar"),
    },
    {
      key: "tasks",
      title: "Úkoly",
      href: "/portal/tasks",
      Icon: portalMenuIcon("tasks"),
    },
    {
      key: "employees",
      title: "Zaměstnanci",
      href: "/portal/employees",
      Icon: portalMenuIcon("employees"),
    },
    {
      key: "attendance",
      title: "Docházka",
      href: "/portal/labor/dochazka",
      Icon: portalMenuIcon("attendance"),
    },
    {
      key: "payroll",
      title: "Výplaty",
      href: "/portal/labor/vyplaty",
      Icon: portalMenuIcon("payroll"),
    },
    {
      key: "hours",
      title: "Hodiny",
      href: hoursHref,
      Icon: portalMenuIcon("hours"),
    },
    {
      key: "jobs",
      title: "Zakázky",
      href: "/portal/jobs",
      Icon: portalMenuIcon("jobs"),
    },
    {
      key: "costs",
      title: "Náklady",
      href: "/portal/finance",
      Icon: portalMenuIcon("costs"),
    },
    {
      key: "chat",
      title: "Komunikace",
      href: "/portal/chat",
      Icon: portalMenuIcon("chat"),
    },
    {
      key: "approvals",
      title: "Schvalování",
      href: "/portal/labor/vykazy",
      Icon: portalMenuIcon("approvals"),
    },
    {
      key: "customers",
      title: "Zákazníci",
      href: "/portal/customers",
      Icon: portalMenuIcon("customers"),
    },
    {
      key: "invoices",
      title: "Faktury",
      href: "/portal/documents?view=issued",
      Icon: portalMenuIcon("invoices"),
    },
    {
      key: "docs",
      title: "Doklady",
      href: "/portal/documents",
      Icon: portalMenuIcon("docs"),
    },
    {
      key: "warehouse",
      title: "Sklad",
      href: "/portal/sklad",
      Icon: portalMenuIcon("sklad"),
    },
    {
      key: "production",
      title: "Výroba",
      href: "/portal/vyroba",
      Icon: portalMenuIcon("vyroba"),
    },
  ];
}

export function buildMobileHomeTiles(input: {
  role: string;
  globalRoles?: string[] | null;
  employeeRow: Record<string, unknown> | null;
  menuCtx: PortalMenuVisibilityCtx;
}): MobileHomeTile[] {
  const { role, globalRoles, employeeRow, menuCtx } = input;

  const portalPermissions = resolveEffectivePortalPermissions({
    role,
    globalRoles: globalRoles ?? undefined,
    employeeDoc: employeeRow,
  });

  const fromSidebar: MobileHomeTile[] = [];
  for (const def of PORTAL_SIDEBAR_MENU_DEFS) {
    if (COVERED_SIDEBAR_IDS.has(def.id)) continue;
    if (!isPortalMenuItemVisible(def, menuCtx)) continue;
    const modId = def.id as PortalModuleId;
    if (!canAccessPortalModule(portalPermissions, modId, "read")) continue;
    fromSidebar.push({
      key: def.id,
      title: def.label,
      href: def.href,
      Icon: portalMenuIcon(def.id),
    });
  }

  const legacy = legacyMobileTiles(role).filter((tile) => {
    if (tile.key === "calendar" || tile.key === "tasks") return true;
    const sidebarDef = PORTAL_SIDEBAR_MENU_DEFS.find(
      (d) => d.href === tile.href || d.id === tile.key
    );
    if (sidebarDef) {
      if (!isPortalMenuItemVisible(sidebarDef, menuCtx)) return false;
      const modId = sidebarDef.id as PortalModuleId;
      if (!canAccessPortalModule(portalPermissions, modId, "read")) return false;
    } else if (tile.key === "attendance" || tile.key === "payroll" || tile.key === "hours" || tile.key === "approvals") {
      const laborDef = PORTAL_SIDEBAR_MENU_DEFS.find((d) => d.id === "labor");
      if (laborDef) {
        if (!isPortalMenuItemVisible(laborDef, menuCtx)) return false;
        if (!canAccessPortalModule(portalPermissions, "labor", "read")) return false;
      }
    } else if (tile.key === "costs") {
      const fin = PORTAL_SIDEBAR_MENU_DEFS.find((d) => d.id === "finance");
      if (fin) {
        if (!isPortalMenuItemVisible(fin, menuCtx)) return false;
        if (!canAccessPortalModule(portalPermissions, "finance", "read")) return false;
      }
    } else if (tile.key === "warehouse") {
      const sk = PORTAL_SIDEBAR_MENU_DEFS.find((d) => d.id === "sklad");
      if (sk && !isPortalMenuItemVisible(sk, menuCtx)) return false;
      if (sk && !canAccessPortalModule(portalPermissions, "sklad", "read")) return false;
    } else if (tile.key === "production") {
      const vy = PORTAL_SIDEBAR_MENU_DEFS.find((d) => d.id === "vyroba");
      if (vy && !isPortalMenuItemVisible(vy, menuCtx)) return false;
      if (vy && !canAccessPortalModule(portalPermissions, "vyroba", "read")) return false;
    }
    return true;
  });

  return [...legacy, ...fromSidebar];
}
