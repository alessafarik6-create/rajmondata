import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { migrateMissingJobNumbersAdmin } from "@/lib/jobs/job-numbering-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "jobs",
    method: "POST",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const role = v.caller.role;
  const canManage =
    role === "owner" || role === "admin" || v.caller.globalRoles.includes("super_admin");
  if (!canManage) {
    return NextResponse.json({ ok: false, error: "Pouze administrátor organizace." }, { status: 403 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") !== "0";
  const companyId = String(url.searchParams.get("companyId") ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const result = await migrateMissingJobNumbersAdmin(v.db, companyId, { dryRun });
  return NextResponse.json({
    ok: true,
    dryRun: result.dryRun,
    count: result.rows.length,
    rows: result.rows,
  });
}
