import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanUseInquiryAi } from "@/lib/ai/permissions";
import { markAiGenerationUsed } from "@/lib/ai/generation-store";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  companyId?: string;
  generationId?: string;
  finalOfferSnapshot?: Record<string, unknown>;
  aiSnapshot?: Record<string, unknown>;
};

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
    if (!callerCanUseInquiryAi(caller)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění používat AI asistenta." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    const generationId = String(body.generationId ?? "").trim();

    if (!companyId || !generationId) {
      return NextResponse.json(
        { ok: false, error: "Chybí companyId nebo generationId." },
        { status: 400 }
      );
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const finalOfferSnapshot =
      body.finalOfferSnapshot && typeof body.finalOfferSnapshot === "object"
        ? body.finalOfferSnapshot
        : {};

    await markAiGenerationUsed(db, {
      companyId,
      generationId,
      callerUid: caller.uid,
      finalOfferSnapshot,
      aiSnapshot:
        body.aiSnapshot && typeof body.aiSnapshot === "object"
          ? body.aiSnapshot
          : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[inquiry-ai/mark-used]", errorMessageFromUnknown(err));
    const msg = err instanceof Error ? err.message : "Uložení se nezdařilo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
