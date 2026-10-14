"use client";

import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";

export function useEmailMailboxManageAccess(): boolean {
  return usePortalPermissionsOptional()?.canManageEmailMailboxes ?? false;
}
