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
import {
  resolveCalendarPermissions,
  type CalendarPermissionsResolved,
} from "@/lib/calendar/calendar-access";

type PortalPermissionsContextValue = {
  permissions: Record<PortalModuleId, PortalAccessLevel>;
  canRead: (moduleId: PortalModuleId) => boolean;
  canWrite: (moduleId: PortalModuleId) => boolean;
  readOnlyPortal: boolean;
  cameras: CameraPermissionsResolved;
  calendar: CalendarPermissionsResolved;
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

    const calendar = resolveCalendarPermissions({
      role: props.role,
      globalRoles: props.globalRoles,
      employeeDoc: props.employeeDoc,
      portalModuleScheduleLevel: permissions.schedule ?? "none",
    });

    return {
      permissions,
      canRead: (moduleId) => {
        if (moduleId === "schedule") return calendar.anyView;
        return canAccessPortalModule(permissions, moduleId, "read");
      },
      canWrite: (moduleId) => {
        if (moduleId === "schedule") return calendar.anyWrite;
        return portalPermissionsAllowMutation(permissions, moduleId, props.role);
      },
      readOnlyPortal,
      cameras,
      calendar,
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
