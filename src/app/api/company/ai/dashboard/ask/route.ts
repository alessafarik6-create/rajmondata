import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canAccessPortalModule } from "@/lib/portal-permissions";
import { resolveCallerPortalPermissions } from "@/lib/portal-permissions-server";
import { OrganizationAiContextService } from "@/lib/ai/organization-ai-context-service";
import { answerOrganizationQuestion } from "@/lib/ai/organization-ai-ask-service";
import { logOrganizationAiQuerySafe } from "@/lib/ai/organization-ai-audit-server";
import type { CompanyPlatformFields } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string; question?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (companyId !== auth.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const question = String(body.question ?? "").trim().slice(0, 2000);
  if (!question) {
    return NextResponse.json({ ok: false, error: "Chybí dotaz." }, { status: 400 });
  }

  const portalPerms = await resolveCallerPortalPermissions(auth.db, auth.caller);
  if (!canAccessPortalModule(portalPerms, "overview", "read")) {
    return NextResponse.json({ ok: false, error: "Bez oprávnění." }, { status: 403 });
  }

  const companySnap = await auth.db.collection("companies").doc(companyId).get();
  const company = (companySnap.data() ?? {}) as CompanyPlatformFields;

  try {
    const svc = new OrganizationAiContextService(auth.db, companyId, auth.caller, company);
    const ctx = await svc.buildContext({ useCache: true });
    const result = await answerOrganizationQuestion({ question, context: ctx });

    await logOrganizationAiQuerySafe(auth.db, companyId, {
      userId: auth.caller.uid,
      actionType: "ORG_AI_ASK",
      questionPreview: question,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[ai/dashboard/ask]", e);
    return NextResponse.json(
      { ok: false, error: "AI odpověď se nepodařila připravit." },
      { status: 500 }
    );
  }
}
