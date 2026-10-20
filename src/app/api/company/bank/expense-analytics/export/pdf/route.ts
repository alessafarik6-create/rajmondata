import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { buildBankExpenseAnalyticsPdfHtml } from "@/lib/bank/expense-analytics-pdf-html";
import { loadExpenseAnalyticsForOrganization } from "@/lib/bank/expense-analytics-load.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const perm = await requireBankRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    datePreset?: string;
    dateFrom?: string;
    dateTo?: string;
    periodLabel?: string;
  };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const sp = new URLSearchParams();
  sp.set("companyId", organizationId);
  if (body.datePreset) sp.set("datePreset", body.datePreset);
  if (body.dateFrom) sp.set("dateFrom", body.dateFrom);
  if (body.dateTo) sp.set("dateTo", body.dateTo);

  const built = await loadExpenseAnalyticsForOrganization(perm.db, organizationId, sp);
  const companySnap = await perm.db.collection("companies").doc(organizationId).get();
  const meta = handoverCompanyPdfMeta(companySnap.data() as Record<string, unknown>);

  const html = buildBankExpenseAnalyticsPdfHtml({
    companyName: meta.contractorCompanyName,
    logoUrl: meta.logoUrl,
    periodLabel: body.periodLabel?.trim() || "Vybrané období",
    summary: built.summary,
    monthly: built.monthly,
    rows: built.rows,
  });

  const pdf = await renderStoredHtmlToPdfBuffer(html);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="analyza-vydaju.pdf"',
    },
  });
}
