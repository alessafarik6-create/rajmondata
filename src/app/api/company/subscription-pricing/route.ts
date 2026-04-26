import { NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { loadDefaultEmployeePriceCzk, loadPlatformPricingDoc } from "@/lib/platform-invoice-auto";

/**
 * Veřejná část ceníku pro přihlášenou organizaci (základ + výchozí cena za zaměstnance).
 */
export async function GET(request: Request) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db } = v;
  try {
    const [pricing, defaultEmployeePriceCzk] = await Promise.all([
      loadPlatformPricingDoc(db),
      loadDefaultEmployeePriceCzk(db),
    ]);
    return NextResponse.json({
      baseLicenseMonthlyCzk: pricing.baseLicenseMonthlyCzk,
      defaultEmployeePriceCzk: defaultEmployeePriceCzk,
      defaultVatPercent: pricing.defaultVatPercent,
    });
  } catch (e) {
    console.error("[company subscription-pricing GET]", e);
    const msg = e instanceof Error ? e.message : "Načtení ceníku se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
