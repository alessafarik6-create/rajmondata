import type { Firestore } from "firebase-admin/firestore";
import { isCompanyPrivileged, type VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  employeeAssignedToJobProduction,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";

export async function assertProductionJobAccess(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  jobId: string
): Promise<{ ok: true; jobData: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const jobRef = db.collection("companies").doc(caller.companyId).collection("jobs").doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Zakázka neexistuje." };
  }
  const data = snap.data() as Record<string, unknown>;
  const settings = parseJobProductionSettings(data);
  const privileged = isCompanyPrivileged(caller.role, caller.globalRoles);
  const allowedForEmployee =
    isCompanyEmployeeRole(caller.role) &&
    caller.employeeId &&
    employeeAssignedToJobProduction(settings, caller.employeeId);

  if (!privileged && !allowedForEmployee) {
    return { ok: false, status: 403, error: "Nemáte přístup k této zakázce ve výrobě." };
  }
  return { ok: true, jobData: data };
}

export function canManageProductionTasks(caller: VerifiedCompanyCaller): boolean {
  return isCompanyPrivileged(caller.role, caller.globalRoles);
}
