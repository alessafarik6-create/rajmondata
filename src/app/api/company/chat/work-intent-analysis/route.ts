import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { ChatWorkIntentAnalysisDoc } from "@/lib/chat/chat-work-intent-types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const v = await verifyCompanyBearerWithPortalAccess(
      request.headers.get("authorization"),
      { moduleId: "chat", method: "GET" }
    );
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    }
    const { caller, db } = v;
    const companyId = caller.companyId;

    if (
      !callerCanUseDocumentAi({
        uid: caller.uid,
        companyId,
        role: caller.role,
        globalRoles: caller.globalRoles,
        isSuperAdmin: caller.globalRoles.includes("super_admin"),
      })
    ) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const analysisId = String(request.nextUrl.searchParams.get("analysisId") ?? "").trim();
    if (!analysisId) {
      return NextResponse.json({ ok: false, error: "Chybí analysisId." }, { status: 400 });
    }

    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("chatWorkIntentAnalyses")
      .doc(analysisId)
      .get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Analýza nenalezena." }, { status: 404 });
    }

    const analysis = { id: snap.id, ...(snap.data() as object) } as ChatWorkIntentAnalysisDoc;
    if (analysis.organizationId && analysis.organizationId !== companyId) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    return NextResponse.json({ ok: true, analysis });
  } catch (err) {
    console.error("[chat/work-intent-analysis]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Načtení se nezdařilo." }, { status: 500 });
  }
}
