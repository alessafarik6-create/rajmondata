"use client";

import React from "react";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import type { PortalModuleId } from "@/lib/portal-permissions";

/** Vykreslí děti jen pokud má uživatel WRITE k modulu (READ = nic mutačního). */
export function PortalMutationGate(props: {
  moduleId: PortalModuleId;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { canWrite } = usePortalModuleAccess(props.moduleId);
  if (!canWrite) return props.fallback ?? null;
  return <>{props.children}</>;
}

/** Prop pro disabled stav u inputů v READ režimu. */
export function usePortalMutationDisabled(moduleId: PortalModuleId): boolean {
  const { canWrite } = usePortalModuleAccess(moduleId);
  return !canWrite;
}
