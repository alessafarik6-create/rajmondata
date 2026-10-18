import type { PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import {
  externalModulePortalPath,
  isExternalModuleEligibleForPortalNav,
} from "@/lib/external-module-portal";
import type { PortalSidebarMenuDef } from "@/lib/portal-menu-config";

export const EXTERNAL_MODULE_MENU_INSERT_AFTER_ID = "jobs";

/** Dynamické položky menu pro externí moduly z katalogu platformy. */
export function buildExternalPortalMenuDefs(
  catalog: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>>
): PortalSidebarMenuDef[] {
  const defs: PortalSidebarMenuDef[] = [];
  for (const code of PLATFORM_MODULE_CODES) {
    const row = catalog[code];
    if (!isExternalModuleEligibleForPortalNav(code, row)) continue;
    defs.push({
      id: code,
      type: "external",
      label: row!.name?.trim() || code,
      href: `${externalModulePortalPath(code)}?auto=1`,
      roles: ["owner", "admin", "manager", "accountant", "employee"],
      platformModuleCode: code,
    });
  }
  defs.sort(
    (a, b) =>
      (catalog[a.platformModuleCode!]?.navOrder ?? 999) -
      (catalog[b.platformModuleCode!]?.navOrder ?? 999)
  );
  return defs;
}

export function mergePortalSidebarMenuDefs(
  base: readonly PortalSidebarMenuDef[],
  external: PortalSidebarMenuDef[]
): PortalSidebarMenuDef[] {
  if (!external.length) return [...base];
  const idx = base.findIndex((d) => d.id === EXTERNAL_MODULE_MENU_INSERT_AFTER_ID);
  const insertAt = idx >= 0 ? idx + 1 : base.length;
  const out = [...base];
  out.splice(insertAt, 0, ...external);
  return out;
}
