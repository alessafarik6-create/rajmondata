"use client";

import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";

export function useCameraPermissions() {
  const ctx = usePortalPermissionsOptional();
  if (!ctx) {
    return { view: true, live: true, playback: true, admin: true };
  }
  return ctx.cameras;
}
