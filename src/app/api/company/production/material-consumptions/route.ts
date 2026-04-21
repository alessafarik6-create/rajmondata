import { NextRequest, NextResponse } from "next/server";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  employeeAssignedToJobProduction,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";

/**
 * Historie spotřeby materiálu na zakázce.
 */
export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  const jobId = String(request.nextUrl.searchParams.get("jobId") || "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });
  }

  const jobRef = db.collection("companies").doc(caller.companyId).collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Zakázka neexistuje." }, { status: 404 });
  }

  const settings = parseJobProductionSettings(jobSnap.data() as Record<string, unknown>);
  const assigned =
    isCompanyEmployeeRole(caller.role) &&
    caller.employeeId &&
    employeeAssignedToJobProduction(settings, caller.employeeId);
  const privileged = isCompanyPrivileged(caller.role, caller.globalRoles);

  if (!assigned && !privileged) {
    return NextResponse.json({ error: "Nemáte přístup." }, { status: 403 });
  }

  const q = await jobRef
    .collection("materialConsumptions")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const rows = q.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ consumptions: rows });
}
