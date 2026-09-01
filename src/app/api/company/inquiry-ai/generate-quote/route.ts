import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanUseInquiryAi } from "@/lib/ai/permissions";
import { generateInquiryAiQuote } from "@/lib/ai/quote-generation-service";
import { normalizeInquiryVatRate } from "@/lib/inquiry-offer-pricing";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  leadKey?: string;
  vatRate?: number | null;
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
    if (caller.role === "customer") {
      return NextResponse.json({ ok: false, error: "Zákazník nemá přístup." }, { status: 403 });
    }
    if (!callerCanUseInquiryAi(caller)) {
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění používat AI asistenta." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    const leadKey = String(body.leadKey ?? "").trim();

    if (!companyId || !leadKey) {
      return NextResponse.json(
        { ok: false, error: "Chybí companyId nebo leadKey." },
        { status: 400 }
      );
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const outcome = await generateInquiryAiQuote({
      db,
      companyId,
      leadKey,
      callerUid: caller.uid,
      vatRate: normalizeInquiryVatRate(body.vatRate ?? 21),
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, error: outcome.error, generationId: outcome.generationId ?? null },
        { status: outcome.status }
      );
    }

    return NextResponse.json({
      ok: true,
      result: outcome.result,
      applyInitial: outcome.applyInitial,
      contextSummary: outcome.contextSummary,
    });
  } catch (err) {
    console.error("[inquiry-ai/generate-quote]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Generování AI návrhu se nezdařilo." },
      { status: 500 }
    );
  }
}
