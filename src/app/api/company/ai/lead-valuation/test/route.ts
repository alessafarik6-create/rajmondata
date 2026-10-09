import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { resolveLeadValuation } from "@/lib/leads/lead-valuation";
import { buildValuationContext } from "@/lib/leads/lead-valuation-service";
import { parseInquiryDimensions } from "@/lib/ai/dimension-parser";
import { matchCatalogItem } from "@/lib/leads/lead-valuation";
import { resolveInquiryTypeRule } from "@/lib/ai/inquiry-type-rules";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import type { LeadImportRow } from "@/lib/lead-import-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    const canManage =
      auth.caller.globalRoles.includes("super_admin") ||
      ["owner", "admin"].includes(auth.caller.role);
    if (!canManage) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    const body = (await request.json()) as { inquiryType?: string; text?: string };
    const inquiryType = String(body.inquiryType ?? "").trim() || "Montované domy";
    const text = String(body.text ?? "").trim();

    const lead: LeadImportRow = {
      id: "test",
      jmeno: "Test",
      telefon: "",
      email: "",
      adresa: "",
      zprava: text,
      typ: inquiryType,
    };

    const ctx = await buildValuationContext(auth.db, auth.caller.companyId, [lead], new Map());
    const typeRule = resolveInquiryTypeRule(inquiryType, ctx.typeRules);
    const catalogMatch = matchCatalogItem(ctx.catalogItems, inquiryType, text);
    const dims = parseInquiryDimensions(text);

    const result = resolveLeadValuation({
      lead,
      overlay: null,
      offer: null,
      priceRules: ctx.priceRules,
      catalogItems: ctx.catalogItems,
      typeRuleName: typeRule.name,
      historicalMedians: ctx.historicalMedians,
      categoryDefaultGross: null,
      useCachedValuation: false,
    });

    return NextResponse.json({
      ok: true,
      dimensions: dims,
      catalogMatch: catalogMatch
        ? { modelName: catalogMatch.modelName, priceGross: catalogMatch.priceGross, areaM2: catalogMatch.areaM2 }
        : null,
      valuation: result,
    });
  } catch (err) {
    console.error("[ai/lead-valuation/test]", errorMessageFromUnknown(err));
    return NextResponse.json({ ok: false, error: "Test ocenění selhal." }, { status: 500 });
  }
}
