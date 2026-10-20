import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canAccessPortalModule } from "@/lib/portal-permissions";
import { resolveCallerPortalPermissions } from "@/lib/portal-permissions-server";
import { OrganizationAiContextService } from "@/lib/ai/organization-ai-context-service";
import {
  buildHotTodayItems,
  buildOrganizationBriefing,
} from "@/lib/ai/organization-ai-briefing";
import { logOrganizationAiQuerySafe } from "@/lib/ai/organization-ai-audit-server";
import type { CompanyPlatformFields } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function headerValue(request: NextRequest, name: string): string | null {
  const v = request.headers.get(name);
  return v?.trim() ? v.trim() : null;
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (companyId !== auth.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const companySnap = await auth.db.collection("companies").doc(companyId).get();
  if (!companySnap.exists) {
    return NextResponse.json({ ok: false, error: "Organizace neexistuje." }, { status: 404 });
  }
  const company = companySnap.data() as CompanyPlatformFields;
  const companyData = companySnap.data() as Record<string, unknown>;

  const portalPerms = await resolveCallerPortalPermissions(auth.db, auth.caller);
  if (!canAccessPortalModule(portalPerms, "overview", "read")) {
    return NextResponse.json({ ok: false, error: "Bez oprávnění k přehledu." }, { status: 403 });
  }

  const mode = String(request.nextUrl.searchParams.get("mode") ?? "briefing");
  const requestId = headerValue(request, "x-request-id") ?? randomUUID();
  const sessionId = headerValue(request, "x-portal-session-id");
  const hotOnly = mode === "hot";
  const actionType = hotOnly ? "ORG_AI_HOT_TODAY" : "ORG_AI_BRIEFING";

  try {
    const svc = new OrganizationAiContextService(auth.db, companyId, auth.caller, company);
    const ctx = await svc.buildContext({ useCache: true });
    const briefing = buildOrganizationBriefing(ctx);

    await logOrganizationAiQuerySafe(auth.db, companyId, {
      caller: auth.caller,
      companyData,
      actionType,
      requestId,
      sessionId,
      processingMs: Date.now() - started,
      status: "ok",
    });

    if (hotOnly) {
      return NextResponse.json({
        ok: true,
        greeting: briefing.greeting,
        items: buildHotTodayItems(ctx),
        contextGeneratedAt: ctx.generatedAt,
      });
    }

    return NextResponse.json(briefing, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    console.error("[ai/dashboard/briefing]", e);
    await logOrganizationAiQuerySafe(auth.db, companyId, {
      caller: auth.caller,
      companyData,
      actionType,
      requestId,
      sessionId,
      processingMs: Date.now() - started,
      status: "error",
      errorMessage: "AI přehled se nyní nepodařilo připravit.",
    });
    return NextResponse.json(
      { ok: false, error: "AI přehled se nyní nepodařilo připravit." },
      { status: 500 }
    );
  }
}
