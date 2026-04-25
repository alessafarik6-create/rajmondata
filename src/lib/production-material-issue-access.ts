import type { Firestore } from "firebase-admin/firestore";
import { isCompanyPrivileged } from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  employeeAssignedToJobProduction,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";

export async function canIssueMaterialToJob(params: {
  db: Firestore;
  companyId: string;
  caller: { role: string; employeeId: string | null; globalRoles: string[] };
  jobId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { db, companyId, caller, jobId } = params;
  if (isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return { ok: true };
  }
  if (!isCompanyEmployeeRole(caller.role) || !caller.employeeId) {
    return { ok: false, status: 403, error: "Nemáte oprávnění k výdeji materiálu." };
  }
  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(caller.employeeId)
    .get();
  const emp = empSnap.data() as Record<string, unknown> | undefined;
  if (!empSnap.exists || emp?.canAccessProduction !== true) {
    return {
      ok: false,
      status: 403,
      error: "V účtu nemáte aktivní přístup k modulu Výroba.",
    };
  }
  const jobSnap = await db.collection("companies").doc(companyId).collection("jobs").doc(jobId).get();
  if (!jobSnap.exists) {
    return { ok: false, status: 404, error: "Zakázka neexistuje." };
  }
  const settings = parseJobProductionSettings(jobSnap.data() as Record<string, unknown>);
  if (!employeeAssignedToJobProduction(settings, caller.employeeId)) {
    return {
      ok: false,
      status: 403,
      error: "Nejste přiřazeni k výrobě této zakázky.",
    };
  }
  return { ok: true };
}
