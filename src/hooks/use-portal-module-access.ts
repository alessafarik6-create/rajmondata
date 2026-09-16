"use client";

import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import type { PortalModuleId } from "@/lib/portal-permissions";

/** READ/WRITE pro modul v UI (skrýt tlačítka Uložit / Přidat). */
export function usePortalModuleAccess(moduleId: PortalModuleId) {
  const ctx = usePortalPermissionsOptional();
  if (!ctx) {
    return { canRead: true, canWrite: true, readOnlyPortal: false };
  }
  return {
    canRead: ctx.canRead(moduleId),
    canWrite: ctx.canWrite(moduleId),
    readOnlyPortal: ctx.readOnlyPortal,
  };
}
