import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import {
  canAccessPortalModule,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import type { AiTutorialDef } from "@/lib/ai-tutor/types";

export function roleAllowedForTutorial(
  role: string,
  tutorial: AiTutorialDef
): boolean {
  if (role === "customer") return false;
  if (!tutorial.roles?.length) return true;
  return (tutorial.roles as string[]).includes(role);
}

export function tutorialAllowedForPermissions(
  tutorial: AiTutorialDef,
  permissions: Record<PortalModuleId, PortalAccessLevel>,
  role: string
): boolean {
  if (!roleAllowedForTutorial(role, tutorial)) return false;
  if (!tutorial.moduleId) return true;
  const level = tutorial.requiredAccess ?? "read";
  return canAccessPortalModule(permissions, tutorial.moduleId, level);
}

export function callerOrgMatch(caller: VerifiedCompanyCaller, companyId: string): boolean {
  return caller.companyId === companyId || caller.globalRoles.includes("super_admin");
}
