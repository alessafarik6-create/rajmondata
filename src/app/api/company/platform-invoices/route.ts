import { NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { listPlatformInvoicesForOrganization, computeEffectivePlatformInvoiceStatus } from "@/lib/platform-billing";

function canReadPlatformBilling(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant";
}

/**
 * Seznam faktur provozovatele platformy pro přihlášenou organizaci (jen čtení).
 */
export async function GET(request: Request) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;
  if (!canReadPlatformBilling(caller.role)) {
    return NextResponse.json({ error: "Přístup jen pro vlastníka, administrátora nebo účetního." }, { status: 403 });
  }
  try {
    const rows = await listPlatformInvoicesForOrganization(db, caller.companyId);
    const eff = (r: (typeof rows)[number]) =>
      computeEffectivePlatformInvoiceStatus(String(r.status), r.dueDate as string);
    const unpaidCount = rows.filter((r) => {
      const e = eff(r);
      return e === "unpaid" || e === "overdue";
    }).length;
    const overdueCount = rows.filter((r) => eff(r) === "overdue").length;
    return NextResponse.json({ invoices: rows, unpaidCount, overdueCount });
  } catch (e) {
    console.error("[company platform-invoices GET]", e);
    const msg = e instanceof Error ? e.message : "Načtení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
