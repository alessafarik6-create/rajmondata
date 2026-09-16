import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { loadLeadPortfolioValueForCompany } from "@/lib/lead-portfolio-value-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
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

    const backfill = request.nextUrl.searchParams.get("backfill") !== "0";
    const result = await loadLeadPortfolioValueForCompany(auth.db, companyId, {
      runBackfill: backfill,
    });

    return NextResponse.json({
      ok: true,
      stats: result.stats,
      importWarning: result.importWarning ?? null,
      rowCount: result.rows.length,
    });
  } catch (err) {
    console.error("[leads/portfolio-value]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Výpočet hodnoty poptávek selhal." },
      { status: 500 }
    );
  }
}
