import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canAccessPortalModule } from "@/lib/portal-permissions";
import { resolveCallerPortalPermissions } from "@/lib/portal-permissions-server";
import { loadOrganizationAiUsageStats } from "@/lib/ai/organization-ai-activity-stats-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() ||
    auth.caller.companyId;
  if (companyId !== auth.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const portalPerms = await resolveCallerPortalPermissions(auth.db, auth.caller);
  const canReport =
    auth.caller.role === "owner" ||
    auth.caller.role === "admin" ||
    auth.caller.globalRoles.includes("super_admin") ||
    canAccessPortalModule(portalPerms, "overview", "read");
  if (!canReport) {
    return NextResponse.json({ ok: false, error: "Bez oprávnění." }, { status: 403 });
  }

  const stats = await loadOrganizationAiUsageStats(auth.db, companyId);
  return NextResponse.json({ ok: true, stats }, { headers: { "Cache-Control": "private, max-age=60" } });
}
