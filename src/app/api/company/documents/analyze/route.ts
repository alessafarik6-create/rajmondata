import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanUseDocumentAi } from "@/lib/ai/permissions";
import { analyzeCompanyDocument } from "@/lib/ai/document-extraction-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json(
        { ok: false, error: "Server není nakonfigurován." },
        { status: 503 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    if (!callerCanUseDocumentAi(caller)) {
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
    if (!callerCanAccessCompany(caller, companyId)) {
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
