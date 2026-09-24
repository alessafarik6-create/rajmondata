import type { PortalAccessLevel, PortalModuleId } from "@/lib/portal-permissions";
import { canAccessPortalModule } from "@/lib/portal-permissions";

/** Export / tisk dat, která uživatel smí **číst** — nevyžaduje WRITE. */
export function canExportPortalModule(
  permissions: Record<PortalModuleId, PortalAccessLevel>,
  moduleId: PortalModuleId
): boolean {
  return canAccessPortalModule(permissions, moduleId, "read");
}

export function canPrintPortalModule(
  permissions: Record<PortalModuleId, PortalAccessLevel>,
  moduleId: PortalModuleId
): boolean {
  return canAccessPortalModule(permissions, moduleId, "read");
}

export type PortalExportAuditPayload = {
  actionType:
    | "DOCUMENT_PRINTED"
    | "DOCUMENT_EXPORTED"
    | "JOB_EXPORTED"
    | "FINANCE_EXPORT_CREATED";
  moduleId?: PortalModuleId;
  entityType?: string;
  entityId?: string | null;
  entityName?: string | null;
  format?: string;
  metadata?: Record<string, unknown>;
};
