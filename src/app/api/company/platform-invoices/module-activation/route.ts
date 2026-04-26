import { NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { issuePlatformInvoiceAdmin } from "@/lib/platform-invoice-issue";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import {
  assertNoOpenModuleActivationInvoice,
  buildModuleActivationLineInput,
} from "@/lib/platform-module-activation-admin";

function canActivateModules(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant";
}

function isModuleCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

/**
 * Vystavení aktivační faktury za modul (`source: moduleActivation`).
 * POST /api/company/platform-invoices/module-activation
 */
export async function POST(request: Request) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canActivateModules(v.caller.role)) {
    return NextResponse.json(
      { error: "Aktivaci modulů mohou spustit jen vlastník, administrátor nebo účetní." },
      { status: 403 }
    );
  }

  let body: { moduleId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const moduleId = String(body.moduleId || "").trim();
  if (!moduleId || !isModuleCode(moduleId)) {
    return NextResponse.json({ error: "Neplatný moduleId." }, { status: 400 });
  }

  const bucket = getAdminStorageBucket();
  if (!bucket) {
    return NextResponse.json({ error: "Firebase Storage není k dispozici." }, { status: 503 });
  }

  try {
    await assertNoOpenModuleActivationInvoice(v.db, v.caller.companyId, moduleId);
    const line = await buildModuleActivationLineInput(v.db, v.caller.companyId, moduleId);

    const today = new Date();
    const periodFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const periodTo = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + 14);
    const dueDate = due.toISOString().slice(0, 10);

    const issued = await issuePlatformInvoiceAdmin({
      db: v.db,
      bucket,
      organizationId: v.caller.companyId,
      periodFrom,
      periodTo,
      dueDate,
      items: [
        {
          kind: "custom",
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceNet: line.unitPriceNet,
          vatRate: line.vatRate,
        },
      ],
      createdBy: `org:${v.caller.uid}`,
      issueSource: "manual",
      skipDuplicateCheck: true,
      platformInvoiceSource: "moduleActivation",
      moduleId,
      moduleName: line.moduleName,
    });

    return NextResponse.json({
      ok: true,
      invoiceId: issued.invoiceId,
      invoiceNumber: issued.invoiceNumber,
      pdfUrl: issued.pdfUrl,
      variableSymbol: issued.variableSymbol,
      amountGross: issued.amountGross,
    });
  } catch (e) {
    console.error("[company platform-invoices module-activation POST]", e);
    const msg = e instanceof Error ? e.message : "Vystavení faktury se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
