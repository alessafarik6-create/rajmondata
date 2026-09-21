"use client";

import React from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  canAccessPortalModule,
  portalModuleIdFromPathname,
  resolveEffectivePortalPermissions,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import { canAccessSchedulePortalRead } from "@/lib/calendar/calendar-access";

export function PortalModuleAccessGate(props: {
  pathname: string;
  role: string;
  globalRoles?: string[] | null;
  employeeDoc?: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  const moduleId = portalModuleIdFromPathname(props.pathname);
  const skip =
    !props.pathname.startsWith("/portal") ||
    props.pathname.startsWith("/portal/customer") ||
    props.pathname.startsWith("/portal/employee") ||
    props.pathname.startsWith("/portal/notifications");

  if (skip || !moduleId) {
    return <>{props.children}</>;
  }

  const permissions = resolveEffectivePortalPermissions({
    role: props.role,
    globalRoles: props.globalRoles,
    employeeDoc: props.employeeDoc,
  });

  const allowed =
    moduleId === "schedule"
      ? canAccessSchedulePortalRead({
          role: props.role,
          globalRoles: props.globalRoles,
          employeeDoc: props.employeeDoc,
        })
      : canAccessPortalModule(permissions, moduleId as PortalModuleId, "read");

  if (allowed) {
    return <>{props.children}</>;
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <Alert variant="destructive">
        <AlertTitle>Bez oprávnění</AlertTitle>
        <AlertDescription>
          K této sekci nemáte oprávnění. Pokud jde o chybu, kontaktujte administrátora organizace.
        </AlertDescription>
      </Alert>
      <Button asChild className="mt-4" variant="outline">
        <Link href="/portal/dashboard">Zpět na přehled</Link>
      </Button>
    </div>
  );
}
