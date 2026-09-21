"use client";

import React, { createContext, useContext, useMemo } from "react";
import {
  canAccessPortalModule,
  portalPermissionsAllowMutation,
  resolveEffectivePortalPermissions,
  roleIsReadOnlyPortal,
  type PortalModuleId,
  type PortalAccessLevel,
} from "@/lib/portal-permissions";
import {
  resolveCameraPermissions,
  type CameraPermissionsResolved,
} from "@/lib/hikvision/camera-access";

type PortalPermissionsContextValue = {
  permissions: Record<PortalModuleId, PortalAccessLevel>;
  canRead: (moduleId: PortalModuleId) => boolean;
  canWrite: (moduleId: PortalModuleId) => boolean;
  readOnlyPortal: boolean;
  cameras: CameraPermissionsResolved;
};

const PortalPermissionsContext = createContext<PortalPermissionsContextValue | null>(null);

export function PortalPermissionsProvider(props: {
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  const value = useMemo((): PortalPermissionsContextValue => {
    const permissions = resolveEffectivePortalPermissions({
      role: props.role,
      globalRoles: props.globalRoles,
      employeeDoc: props.employeeDoc,
    });
    const readOnlyPortal = roleIsReadOnlyPortal(props.role);

    const cameras = resolveCameraPermissions({
      role: props.role,
      globalRoles: props.globalRoles,
      employeeDoc: props.employeeDoc,
      portalModuleCamerasLevel: permissions.cameras ?? "none",
    });

    return {
      permissions,
      canRead: (moduleId) => canAccessPortalModule(permissions, moduleId, "read"),
      canWrite: (moduleId) =>
        portalPermissionsAllowMutation(permissions, moduleId, props.role),
      readOnlyPortal,
      cameras,
    };
  }, [props.role, props.globalRoles, props.employeeDoc]);

  return (
    <PortalPermissionsContext.Provider value={value}>
      {props.children}
    </PortalPermissionsContext.Provider>
  );
}

export function usePortalPermissions(): PortalPermissionsContextValue {
  const ctx = useContext(PortalPermissionsContext);
  if (!ctx) {
    throw new Error("usePortalPermissions musí být uvnitř PortalPermissionsProvider");
  }
  return ctx;
}

export function usePortalPermissionsOptional(): PortalPermissionsContextValue | null {
  return useContext(PortalPermissionsContext);
}
