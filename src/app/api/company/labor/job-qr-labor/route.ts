import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { loadJobQrLaborSummary } from "@/lib/labor/employee-work-statement-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "jobs",
    method: "GET",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Chybí jobId." }, { status: 400 });
  }

  const summary = await loadJobQrLaborSummary({
    db: v.db,
    companyId: v.caller.companyId,
    jobId,
  });

  return NextResponse.json({ ok: true, jobId, ...summary });
}
