/**
 * Oprávnění pro AI asistenta u poptávek.
 */

import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";

export function callerCanUseInquiryAi(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  return ["owner", "admin", "manager", "accountant"].includes(caller.role);
}
