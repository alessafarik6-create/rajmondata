"use client";

import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import type { PortalModuleId } from "@/lib/portal-permissions";

/** READ/WRITE pro modul v UI (skrýt tlačítka Uložit / Přidat). */
export function usePortalModuleAccess(moduleId: PortalModuleId) {
  const ctx = usePortalPermissionsOptional();
  if (!ctx) {
    return { canRead: true, canWrite: true, readOnlyPortal: false, isReadOnly: false };
  }
  const canRead = ctx.canRead(moduleId);
  const canWrite = ctx.canWrite(moduleId);
  return {
    canRead,
    canWrite,
    readOnlyPortal: ctx.readOnlyPortal,
    /** READ bez WRITE — žádné mutace v tomto modulu. */
    isReadOnly: canRead && !canWrite,
  };
}

/** Alias pro mutační UI. */
export function usePortalWrite(moduleId: PortalModuleId): boolean {
  return usePortalModuleAccess(moduleId).canWrite;
}
