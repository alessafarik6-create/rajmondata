import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { getCompanies } from "@/lib/superadmin-companies";
import { loadOrganizationEntityCounts } from "@/lib/portal-analytics/org-stats-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const companies = await getCompanies(db, { light: true });
  const lines = [
    [
      "organizationId",
      "name",
      "registeredAt",
      "users",
      "employees",
      "jobs",
      "leads",
      "offers",
      "invoices",
    ].join(";"),
  ];

  for (const c of companies.slice(0, 500)) {
    const counts = await loadOrganizationEntityCounts(db, c.id);
    lines.push(
      [
        c.id,
        `"${String(c.name).replace(/"/g, '""')}"`,
        c.createdAt ?? "",
        counts.userAccounts,
        counts.employees,
        counts.jobs,
        counts.leads,
        counts.offers,
        counts.invoices,
      ].join(";")
    );
  }

  const csv = "\uFEFF" + lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rajmondata-organizace-analytika.csv"`,
    },
  });
}
