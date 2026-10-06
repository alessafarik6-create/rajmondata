import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { assertProductionJobAccess } from "@/lib/production-qr/production-access";
import {
  buildJobProductionTimeReport,
  formatDurationCs,
} from "@/lib/production-qr/production-time-report";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });

  const access = await assertProductionJobAccess(v.db, v.caller, jobId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const report = await buildJobProductionTimeReport(v.db, v.caller.companyId, jobId);
  return NextResponse.json({
    ok: true,
    report,
    totalLabel: formatDurationCs(report.totalSeconds),
  });
}
