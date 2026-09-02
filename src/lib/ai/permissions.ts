/**
 * Oprávnění pro AI asistenta u poptávek.
 */

import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";

export function callerCanUseInquiryAi(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  return ["owner", "admin", "manager", "accountant"].includes(caller.role);
}

export function callerCanUseDocumentAi(caller: VerifiedCompanyCaller): boolean {
  return callerCanUseInquiryAi(caller);
}

/** Správa AI centra — pouze owner/admin. */
export function callerCanManageAiCenter(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  return ["owner", "admin"].includes(caller.role);
}
