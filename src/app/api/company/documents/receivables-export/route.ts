import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  buildReceivablesPayablesExportRows,
  exportRowsToCsvBuffer,
  exportRowsToXlsxBuffer,
  type ReceivablesExportFilters,
} from "@/lib/documents/receivables-payables-export";
import { exportReceivablesPayablesPdfBuffer } from "@/lib/documents/receivables-payables-pdf";
import { fetchLogoAsDataUrl } from "@/lib/leads/preliminary-deal-export";

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

  const format = String(url.searchParams.get("format") ?? "csv").toLowerCase();
  const todayIso =
    String(url.searchParams.get("today") ?? "").trim() ||
    new Date().toISOString().split("T")[0];

  const filters: ReceivablesExportFilters = {
    scope:
      url.searchParams.get("scope") === "payables"
        ? "payables"
        : url.searchParams.get("scope") === "both"
          ? "both"
          : "receivables",
    dateField: url.searchParams.get("dateField") === "issued" ? "issued" : "due",
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
    paymentStatus:
      (url.searchParams.get("paymentStatus") as ReceivablesExportFilters["paymentStatus"]) ??
      "all",
    partnerQuery: url.searchParams.get("partner"),
    jobId: url.searchParams.get("jobId"),
    currency: url.searchParams.get("currency"),
  };

  const [docSnap, invSnap, jobsSnap, companySnap] = await Promise.all([
    v.db.collection("companies").doc(companyId).collection("documents").get(),
    v.db.collection("companies").doc(companyId).collection("invoices").get(),
    v.db.collection("companies").doc(companyId).collection("jobs").get(),
    v.db.collection("companies").doc(companyId).get(),
  ]);

  const jobNamesById: Record<string, string> = {};
  for (const j of jobsSnap.docs) {
    const d = j.data() as { title?: string; name?: string };
    jobNamesById[j.id] = String(d.title ?? d.name ?? j.id);
  }

  const rows = buildReceivablesPayablesExportRows({
    documents: docSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })),
    invoices: invSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })),
    jobNamesById,
    todayIso,
    filters,
  });

  const orgName = String(
    companySnap.data()?.companyName ?? companySnap.data()?.name ?? "Organizace"
  );
  const periodLabel = [filters.dateFrom, filters.dateTo].filter(Boolean).join(" – ") || "Vše";
  const title =
    filters.scope === "payables"
      ? "Přehled závazků"
      : filters.scope === "both"
        ? "Přehled pohledávek a závazků"
        : "Přehled pohledávek";
  const baseName = `export-${filters.scope}-${companyId.slice(0, 8)}`;

  if (format === "xlsx") {
    const buf = exportRowsToXlsxBuffer(rows);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    });
  }
  if (format === "pdf") {
    const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
    const logoDataUrl = await fetchLogoAsDataUrl(
      String(companyData.organizationLogoUrl ?? "").trim() || null
    );
    const buf = await exportReceivablesPayablesPdfBuffer({
      rows,
      companyDoc: companyData,
      logoDataUrl,
      orgName,
      title,
      periodLabel,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      },
    });
  }

  const csv = exportRowsToCsvBuffer(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  });
}
