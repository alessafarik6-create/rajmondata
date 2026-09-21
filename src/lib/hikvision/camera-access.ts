import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import {
  canAccessCompanyModule,
  type CompanyPlatformFields,
} from "@/lib/platform-access";
import type { PlatformModuleCode } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import { defaultPlatformCatalogMap } from "@/lib/platform-module-catalog";
import {
  resolveEffectivePortalPermissions,
  type PortalAccessLevel,
} from "@/lib/portal-permissions";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import { HIKVISION_PERMISSION } from "@/lib/hikvision/permissions";

export type CameraPermissionFlag = "view" | "live" | "playback" | "admin";

export type CameraPermissionsResolved = {
  view: boolean;
  live: boolean;
  playback: boolean;
  admin: boolean;
};

export type CameraPermissionsDoc = {
  view?: boolean;
  live?: boolean;
  playback?: boolean;
  admin?: boolean;
};

function parseCameraPermissionsDoc(
  employeeDoc: Record<string, unknown> | null | undefined
): CameraPermissionsDoc {
  const raw = employeeDoc?.cameraPermissions;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    view: o.view === true,
    live: o.live === true,
    playback: o.playback === true,
    admin: o.admin === true,
  };
}

function isOrgCamerasModuleEnabled(
  company: CompanyPlatformFields | null | undefined,
  catalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  if (!company) return false;
  const cat =
    catalog && Object.keys(catalog).length > 0
      ? { ...defaultPlatformCatalogMap(), ...catalog }
      : defaultPlatformCatalogMap();
  return canAccessCompanyModule(company, "cameras", cat);
}

/** Owner / admin organizace — plná camera oprávnění pokud je modul aktivní. */
function isOrgCameraPrivilegedRole(role: string, globalRoles?: string[] | null): boolean {
  const r = normalizeCompanyRole(role);
  if (r === "owner" || r === "admin" || r === "manager") return true;
  if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) return true;
  return false;
}

export function resolveCameraPermissions(input: {
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
  portalModuleCamerasLevel?: PortalAccessLevel;
}): CameraPermissionsResolved {
  const portalLevel =
    input.portalModuleCamerasLevel ??
    resolveEffectivePortalPermissions({
      role: input.role,
      globalRoles: input.globalRoles ?? undefined,
      employeeDoc: input.employeeDoc,
    }).cameras ??
    "none";

  if (isOrgCameraPrivilegedRole(input.role, input.globalRoles)) {
    return { view: true, live: true, playback: true, admin: true };
  }

  const flags = parseCameraPermissionsDoc(input.employeeDoc);
  const portalRead = portalLevel === "read" || portalLevel === "write";
  const view = portalRead && (flags.view === true || portalLevel === "write");
  const admin = flags.admin === true || portalLevel === "write";
  return {
    view: view || admin,
    live: (view && flags.live === true) || admin,
    playback: (view && flags.playback === true) || admin,
    admin,
  };
}

export function callerHasCameraPermission(
  caller: VerifiedCompanyCaller,
  employeeDoc: Record<string, unknown> | null,
  flag: CameraPermissionFlag,
  portalLevel?: PortalAccessLevel
): boolean {
  const perms = resolveCameraPermissions({
    role: caller.role,
    globalRoles: caller.globalRoles,
    employeeDoc,
    portalModuleCamerasLevel: portalLevel,
  });
  switch (flag) {
    case "view":
      return perms.view;
    case "live":
      return perms.live;
    case "playback":
      return perms.playback;
    case "admin":
      return perms.admin;
    default:
      return false;
  }
}

export function assertOrganizationCamerasModule(
  company: CompanyPlatformFields | null | undefined,
  catalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  return isOrgCamerasModuleEnabled(company, catalog);
}

export { HIKVISION_PERMISSION };

export function normalizeCameraPermissionsForFirestore(input: {
  view?: boolean;
  live?: boolean;
  playback?: boolean;
  admin?: boolean;
}): CameraPermissionsDoc | null {
  const admin = input.admin === true;
  const view = admin || input.view === true;
  const live = admin || (view && input.live === true);
  const playback = admin || (view && input.playback === true);
  if (!view && !live && !playback && !admin) return null;
  return { view, live, playback, admin };
}
