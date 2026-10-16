import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { parsePreliminaryDealDoc } from "@/lib/leads/preliminary-deal-server";
import {
  companyDocToPreliminaryDealProfile,
  exportPreliminaryDealsListPdfBuffer,
  exportPreliminaryDealsToCsvBuffer,
  exportPreliminaryDealsToXlsxBuffer,
  exportSinglePreliminaryDealPdfBuffer,
  fetchLogoAsDataUrl,
  formatPreliminaryDealsPeriodLabel,
  type PreliminaryDealExportRow,
} from "@/lib/leads/preliminary-deal-export";
import {
  buildEmployeeNameMap,
  enrichPreliminaryDealRowResponsibleName,
  mapEmployeesToPreliminaryDealOptions,
} from "@/lib/leads/preliminary-deal-employees";
import { preliminaryDealMatchesFilters } from "@/lib/leads/preliminary-deal-summary";
import type { PreliminaryDealStatus } from "@/lib/leads/preliminary-deal-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseCreatedAt(raw: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "leads",
    method: "GET",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const url = new URL(request.url);
  const companyId = String(url.searchParams.get("companyId") ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const format = String(url.searchParams.get("format") ?? "csv").toLowerCase();
  const dealId = String(url.searchParams.get("dealId") ?? "").trim();
  const idsParam = String(url.searchParams.get("ids") ?? "").trim();
  const selectedIds = idsParam ? idsParam.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
  const dateTo = url.searchParams.get("dateTo") ?? undefined;

  const [dealsSnap, companySnap, employeesSnap] = await Promise.all([
    v.db.collection("companies").doc(companyId).collection("preliminary_deals").get(),
    v.db.collection("companies").doc(companyId).get(),
    v.db.collection("companies").doc(companyId).collection("employees").get(),
  ]);

  const employeeOptions = mapEmployeesToPreliminaryDealOptions(
    employeesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  );
  const nameByEmployeeId = buildEmployeeNameMap(employeeOptions);

  let rows: PreliminaryDealExportRow[] = [];
  for (const d of dealsSnap.docs) {
    const parsed = parsePreliminaryDealDoc(d.id, d.data() as Record<string, unknown>);
    if (parsed) {
      rows.push(enrichPreliminaryDealRowResponsibleName(parsed, nameByEmployeeId));
    }
  }

  if (dealId) {
    rows = rows.filter((r) => r.id === dealId);
  } else if (selectedIds.length) {
    const set = new Set(selectedIds);
    rows = rows.filter((r) => set.has(r.id));
  } else {
    const filters = {
      q: url.searchParams.get("q") ?? undefined,
      status: (url.searchParams.get("status") as PreliminaryDealStatus | "all" | null) ?? "all",
      responsibleEmployeeId: url.searchParams.get("responsibleEmployeeId") ?? "all",
      dateFrom,
      dateTo,
    };
    rows = rows.filter((r) =>
      preliminaryDealMatchesFilters(r, filters, parseCreatedAt(r.createdAt))
    );
  }

  const companyData = (companySnap.data() ?? {}) as Record<string, unknown>;
  const logoDataUrl = await fetchLogoAsDataUrl(
    String(companyData.organizationLogoUrl ?? "").trim() || null
  );
  const profile = companyDocToPreliminaryDealProfile(companyData, logoDataUrl);
  const periodLabel = formatPreliminaryDealsPeriodLabel(dateFrom, dateTo);

  let buffer: Buffer;
  let contentType: string;
  let filename: string;

  if (format === "pdf" && dealId && rows.length === 1) {
    buffer = await exportSinglePreliminaryDealPdfBuffer(rows[0]!, profile);
    contentType = "application/pdf";
    filename = `predjednana-zakazka-${dealId}.pdf`;
  } else if (format === "pdf") {
    buffer = await exportPreliminaryDealsListPdfBuffer(rows, profile, periodLabel);
    contentType = "application/pdf";
    filename = "predjednane-zakazky.pdf";
  } else if (format === "xlsx") {
    buffer = exportPreliminaryDealsToXlsxBuffer(rows);
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    filename = "predjednane-zakazky.xlsx";
  } else {
    buffer = exportPreliminaryDealsToCsvBuffer(rows);
    contentType = "text/csv; charset=utf-8";
    filename = "predjednane-zakazky.csv";
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
