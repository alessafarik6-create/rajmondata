import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { calculateDocumentPaymentSummary } from "@/lib/portal-payment-summary";
import type { CompanyDocumentPaymentRow } from "@/lib/company-document-payment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(
    request.headers.get("authorization"),
    { moduleId: "documents", method: "GET" }
  );
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const url = new URL(request.url);
  const companyId = String(url.searchParams.get("companyId") ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId && !v.caller.globalRoles.includes("super_admin")) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const todayIso =
    String(url.searchParams.get("today") ?? "").trim() ||
    new Date().toISOString().split("T")[0];

  const [docSnap, invSnap] = await Promise.all([
    v.db.collection("companies").doc(companyId).collection("documents").get(),
    v.db.collection("companies").doc(companyId).collection("invoices").get(),
  ]);

  const documents = docSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  })) as CompanyDocumentPaymentRow[];
  const invoices = invSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  }));

  const stats = calculateDocumentPaymentSummary(documents, invoices, todayIso);

  return NextResponse.json(
    { ok: true, todayIso, stats },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
