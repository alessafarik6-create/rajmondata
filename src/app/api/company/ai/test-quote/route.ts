import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { callerCanManageAiCenter } from "@/lib/ai/permissions";
import { runTestAiQuote } from "@/lib/ai/quote-test-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  inquiryType?: string;
  inquiryText?: string;
  vatRate?: number | null;
};

export async function POST(request: NextRequest) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    if (!callerCanManageAiCenter(caller)) {
      return NextResponse.json({ ok: false, error: "Pouze admin může spouštět test AI." }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const outcome = await runTestAiQuote({
      db,
      companyId,
      inquiryType: String(body.inquiryType ?? "").trim(),
      inquiryText: String(body.inquiryText ?? "").trim(),
      vatRate: body.vatRate ?? 21,
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json({
      ok: true,
      result: outcome.result,
      contextSummary: outcome.contextSummary,
      explainability: outcome.explainability,
    });
  } catch (err) {
    console.error("[ai/test-quote]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Test AI se nezdařil." }, { status: 500 });
  }
}
