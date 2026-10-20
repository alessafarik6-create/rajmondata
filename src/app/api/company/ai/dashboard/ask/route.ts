import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canAccessPortalModule } from "@/lib/portal-permissions";
import { resolveCallerPortalPermissions } from "@/lib/portal-permissions-server";
import { OrganizationAiContextService } from "@/lib/ai/organization-ai-context-service";
import { answerOrganizationQuestion } from "@/lib/ai/organization-ai-ask-service";
import { logOrganizationAiQuerySafe } from "@/lib/ai/organization-ai-audit-server";
import type { CompanyPlatformFields } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function headerValue(request: NextRequest, name: string): string | null {
  const v = request.headers.get(name);
  return v?.trim() ? v.trim() : null;
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string; question?: string; requestId?: string } = {};
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
  const companyData = companySnap.data() as Record<string, unknown> | undefined;

  const bodyRequestId =
    typeof body.requestId === "string" ? body.requestId.trim() : "";
  const requestId =
    headerValue(request, "x-request-id") ?? (bodyRequestId || randomUUID());
  const sessionId = headerValue(request, "x-portal-session-id");

  try {
    const svc = new OrganizationAiContextService(auth.db, companyId, auth.caller, company);
    const ctx = await svc.buildContext({ useCache: true });
    const result = await answerOrganizationQuestion({ question, context: ctx });

    await logOrganizationAiQuerySafe(auth.db, companyId, {
      caller: auth.caller,
      companyData: companyData ?? null,
      actionType: "ORG_AI_ASK",
      questionText: question,
      requestId,
      sessionId,
      processingMs: Date.now() - started,
      status: "ok",
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[ai/dashboard/ask]", e);
    await logOrganizationAiQuerySafe(auth.db, companyId, {
      caller: auth.caller,
      companyData: companyData ?? null,
      actionType: "ORG_AI_ASK",
      questionText: question,
      requestId,
      sessionId,
      processingMs: Date.now() - started,
      status: "error",
      errorMessage: "AI odpověď se nepodařila připravit.",
    });
    return NextResponse.json(
      { ok: false, error: "AI odpověď se nepodařila připravit." },
      { status: 500 }
    );
  }
}
