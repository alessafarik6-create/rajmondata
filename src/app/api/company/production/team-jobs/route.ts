import { NextRequest, NextResponse } from "next/server";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import {
  buildProductionSafeJobView,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";
import { deriveCustomerDisplayNameFromJob } from "@/lib/job-customer-client";
import { parseProductionWorkflowStatus } from "@/lib/production-job-workflow";

/**
 * Zakázky s výrobním týmem nebo aktivním workflow — pro vedení (bez citlivých údajů).
 */
export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  if (!isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return NextResponse.json({ error: "Pouze vedení organizace." }, { status: 403 });
  }

  const snap = await db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .limit(250)
    .get();

  const jobs = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const ids = Array.isArray(data.productionAssignedEmployeeIds)
        ? data.productionAssignedEmployeeIds.filter(Boolean).length
        : 0;
      const wf = parseProductionWorkflowStatus(data);
      if (ids === 0 && wf === "not_started") return null;
      const settings = parseJobProductionSettings(data);
      const customerDisplayName = deriveCustomerDisplayNameFromJob(
        data as Parameters<typeof deriveCustomerDisplayNameFromJob>[0]
      );
      return buildProductionSafeJobView({
        jobId: d.id,
        job: data,
        settings,
        customerDisplayName,
      });
    })
    .filter(Boolean);

  jobs.sort((a, b) => {
    const ta = String((a as { productionStartedAt?: string }).productionStartedAt || "");
    const tb = String((b as { productionStartedAt?: string }).productionStartedAt || "");
    return tb.localeCompare(ta);
  });

  return NextResponse.json({ jobs });
}
