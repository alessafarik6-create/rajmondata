import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  loadLeadSummaryForCompany,
  parseLeadSummaryFiltersFromSearchParams,
} from "@/lib/leads/lead-summary-service";
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

    const filters = parseLeadSummaryFiltersFromSearchParams(request.nextUrl.searchParams);
    const { stats, importWarning } = await loadLeadSummaryForCompany(auth.db, companyId, filters);

    return NextResponse.json({
      ok: true,
      count: stats.count,
      estimatedValue: stats.estimatedValue,
      averageValue: stats.averageValue,
      withoutValue: stats.withoutValue,
      byType: stats.byType,
      byStatus: stats.byStatus,
      importWarning: importWarning ?? null,
    });
  } catch (err) {
    console.error("[leads/summary]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Souhrn poptávek se nepodařilo vypočítat." },
      { status: 500 }
    );
  }
}
