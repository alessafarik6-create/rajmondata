import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { callerCanAccessCompany } from "@/lib/api-verify-company-user";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import { analyzeCompanyDocument } from "@/lib/ai/document-extraction-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const v = await verifyCompanyBearerWithPortalAccess(
      request.headers.get("authorization"),
      { moduleId: "documents", method: "POST" }
    );
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
    }
    const { caller, db } = v;

    const callerForAi = {
      uid: caller.uid,
      companyId: caller.companyId,
      role: caller.role,
      globalRoles: caller.globalRoles,
      isSuperAdmin: caller.globalRoles.includes("super_admin"),
    };
    if (!callerCanUseDocumentAi(callerForAi)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění používat AI analýzu dokladů." },
        { status: 403 }
      );
    }

    const form = await request.formData();
    const companyId = String(form.get("companyId") ?? "").trim();
    const file = form.get("file");

    if (!companyId) {
      return NextResponse.json(
        { ok: false, error: "Chybí companyId." },
        { status: 400 }
      );
    }
    if (!callerCanAccessCompany(callerForAi, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Chybí soubor dokladu." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const outcome = await analyzeCompanyDocument({
      db,
      companyId,
      fileBuffer: buffer,
      mimeType: file.type || "application/octet-stream",
      fileName: file.name || "document",
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, error: outcome.error },
        { status: outcome.status }
      );
    }

    return NextResponse.json({
      ok: true,
      readable: outcome.readable,
      unreadableReason: outcome.unreadableReason,
      formPatch: outcome.formPatch,
      direction: outcome.direction,
      warnings: outcome.warnings,
      confidence: outcome.confidence,
      filledFields: outcome.filledFields,
      lowConfidenceFields: outcome.lowConfidenceFields,
      duplicateCandidates: outcome.duplicateCandidates,
      suggestedJobs: outcome.suggestedJobs,
      supplierMatch: outcome.supplierMatch,
      model: outcome.model,
      searchableText: outcome.searchableText,
      aiMeta: {
        ...outcome.aiMeta,
        analysedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[documents/analyze]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Analýza dokladu se nezdařila." },
      { status: 500 }
    );
  }
}
