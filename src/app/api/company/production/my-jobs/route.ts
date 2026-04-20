import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  buildProductionSafeJobView,
  parseJobProductionSettings,
  employeeAssignedToJobProduction,
} from "@/lib/job-production-settings";
import { deriveCustomerDisplayNameFromJob } from "@/lib/job-customer-client";

/**
 * Zakázky přiřazené aktuálnímu zaměstnanci pro výrobu (bez citlivých údajů).
 */
export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  if (caller.role !== "employee" || !caller.employeeId) {
    return NextResponse.json(
      { error: "Endpoint je určen pro zaměstnanecký účet s employeeId." },
      { status: 403 }
    );
  }

  const q = db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .where("productionAssignedEmployeeIds", "array-contains", caller.employeeId)
    .limit(80);

  const snap = await q.get();
  const jobs = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const settings = parseJobProductionSettings(data);
    if (!employeeAssignedToJobProduction(settings, caller.employeeId)) return null;
    const customerDisplayName = deriveCustomerDisplayNameFromJob(
      data as Parameters<typeof deriveCustomerDisplayNameFromJob>[0]
    );
    return buildProductionSafeJobView({
      jobId: d.id,
      job: data,
      settings,
      customerDisplayName,
    });
  });

  return NextResponse.json({
    jobs: jobs.filter(Boolean),
  });
}
