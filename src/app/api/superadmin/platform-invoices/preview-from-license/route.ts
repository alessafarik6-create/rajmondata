import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  buildAutomaticPlatformInvoiceLineInputs,
  loadDefaultEmployeePriceCzk,
  loadLicenseAndCompanyForAutoInvoice,
  loadMergedCatalogFromFirestore,
  loadPlatformPricingDoc,
} from "@/lib/platform-invoice-auto";
import { buildLineRowsFromInput, sumInvoiceLines, type PlatformInvoiceLineInput } from "@/lib/platform-billing";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

type Body = {
  organizationId?: string;
  periodFrom?: string;
  periodTo?: string;
  extraItems?: PlatformInvoiceLineInput[];
};

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const organizationId = String(body.organizationId || "").trim();
  const periodFrom = String(body.periodFrom || "").trim().slice(0, 10);
  const periodTo = String(body.periodTo || "").trim().slice(0, 10);
  if (!organizationId || !periodFrom || !periodTo) {
    return NextResponse.json({ error: "organizationId, periodFrom, periodTo jsou povinné." }, { status: 400 });
  }
  try {
    await ensureAllPlatformData(db);
    const [pricing, catalog, defEmp, ctx] = await Promise.all([
      loadPlatformPricingDoc(db),
      loadMergedCatalogFromFirestore(db),
      loadDefaultEmployeePriceCzk(db),
      loadLicenseAndCompanyForAutoInvoice(db, organizationId),
    ]);
    const items = buildAutomaticPlatformInvoiceLineInputs({
      platformCompany: ctx.platformCompany,
      license: ctx.license,
      catalog,
      pricing,
      defaultEmployeePriceCzk: defEmp,
      employeeCount: ctx.employeeCount,
      periodFrom,
      periodTo,
      extraItems: Array.isArray(body.extraItems) ? body.extraItems : undefined,
    });
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Žádné fakturovatelné položky — zkontrolujte moduly a ceník (platform_modules + pricing)." },
        { status: 400 }
      );
    }
    const lineRows = buildLineRowsFromInput(items);
    const sums = sumInvoiceLines(lineRows);
    return NextResponse.json({
      ok: true,
      organizationId,
      employeeCount: ctx.employeeCount,
      items,
      lineRows,
      ...sums,
    });
  } catch (e) {
    console.error("[preview-from-license]", e);
    const msg = e instanceof Error ? e.message : "Náhled se nezdařil.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
