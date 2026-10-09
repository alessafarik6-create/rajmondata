import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { parseLeadSummaryFiltersFromSearchParams } from "@/lib/leads/lead-summary-service";
import {
  runLeadValuationBatch,
  type BatchValuationMode,
} from "@/lib/leads/lead-valuation-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const companyId = String(
      request.nextUrl.searchParams.get("companyId") ?? auth.caller.companyId
    ).trim();

    if (companyId !== auth.caller.companyId && !auth.caller.globalRoles.includes("super_admin")) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      mode?: BatchValuationMode;
      filters?: Record<string, string>;
    };

    const mode: BatchValuationMode =
      body.mode === "missing_value" || body.mode === "recompute_ai" ? body.mode : "filtered";

    const filters = parseLeadSummaryFiltersFromSearchParams(request.nextUrl.searchParams);
    if (body.filters) {
      if (body.filters.q) filters.search = body.filters.q;
      if (body.filters.typ) filters.filterTyp = body.filters.typ;
    }

    const result = await runLeadValuationBatch(auth.db, companyId, { mode, filters });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[leads/valuate-batch]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Dávkové ocenění selhalo." },
      { status: 500 }
    );
  }
}
