import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  assertProductionJobAccess,
  canManageProductionTasks,
} from "@/lib/production-qr/production-access";
import { regenerateProductionTaskQr } from "@/lib/production-qr/production-task-admin";
import { resolveProductionScanUrl } from "@/lib/production-qr/production-task-paths";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManageProductionTasks(v.caller)) {
    return NextResponse.json({ error: "Regeneraci QR může provádět vedení." }, { status: 403 });
  }
  const { taskId } = await ctx.params;
  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });

  const access = await assertProductionJobAccess(v.db, v.caller, jobId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { publicToken } = await regenerateProductionTaskQr(
    v.db,
    v.caller.companyId,
    jobId,
    taskId
  );
  return NextResponse.json({
    ok: true,
    scanUrl: resolveProductionScanUrl(request.nextUrl.origin, publicToken),
    publicToken,
  });
}
