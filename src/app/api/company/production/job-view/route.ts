import { NextRequest, NextResponse } from "next/server";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  buildProductionSafeJobView,
  parseJobProductionSettings,
  employeeAssignedToJobProduction,
} from "@/lib/job-production-settings";
import { deriveCustomerDisplayNameFromJob } from "@/lib/job-customer-client";

/**
 * Jedna zakázka — bezpečný náhled pro výrobní tým.
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
  const snap = await jobRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Zakázka neexistuje." }, { status: 404 });
  }

  const data = snap.data() as Record<string, unknown>;
  const settings = parseJobProductionSettings(data);

  const allowedForEmployee =
    isCompanyEmployeeRole(caller.role) &&
    caller.employeeId &&
    employeeAssignedToJobProduction(settings, caller.employeeId);

  const privileged = isCompanyPrivileged(caller.role, caller.globalRoles);

  if (!allowedForEmployee && !privileged) {
    return NextResponse.json({ error: "Nemáte přístup k této zakázce ve výrobě." }, { status: 403 });
  }

  const customerDisplayName = deriveCustomerDisplayNameFromJob(
    data as Parameters<typeof deriveCustomerDisplayNameFromJob>[0]
  );

  return NextResponse.json({
    job: buildProductionSafeJobView({
      jobId,
      job: data,
      settings,
      customerDisplayName,
    }),
    settings: {
      productionVisibleFolderIds: settings.productionVisibleFolderIds,
    },
  });
}
