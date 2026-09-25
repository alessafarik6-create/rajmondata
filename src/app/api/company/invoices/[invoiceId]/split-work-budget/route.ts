import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { canManagePortalInvoices } from "@/lib/portal-invoice-permissions";
import {
  buildWorkBudgetSplitPreview,
  canSplitWorkBudgetInvoice,
  classifyWorkBudgetInvoiceLines,
  parseInvoiceLinesFromDoc,
  type WorkBudgetSplitLineBucket,
} from "@/lib/work-budget-invoice-split";
import { isWorkBudgetSourceInvoice } from "@/lib/work-budget-invoice";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  parseJobWorkBudgetItemFromFirestore,
  WORK_BUDGET_ITEMS_COLLECTION,
} from "@/lib/work-budget-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ invoiceId: string }> };

/** Server-side validace rozdělení (skutečné rozdělení probíhá atomicky z klienta). */
export async function POST(request: NextRequest, { params }: Params) {
  const v = await verifyCompanyBearerWithPortalAccess(
    request.headers.get("authorization"),
    { moduleId: "invoices", method: "POST" }
  );
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }
  if (!canManagePortalInvoices(v.caller.role)) {
    return NextResponse.json(
      { ok: false, error: "Nemáte oprávnění rozdělit fakturu." },
      { status: 403 }
    );
  }

  const { invoiceId } = await params;
  let body: {
    companyId?: string;
    jobId?: string;
    manualAssignments?: Record<string, WorkBudgetSplitLineBucket>;
  } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const companyId = String(body.companyId ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId && !v.caller.globalRoles.includes("super_admin")) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Chybí jobId." }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: "Serverová validace není k dispozici." },
      { status: 503 }
    );
  }

  const invSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("invoices")
    .doc(invoiceId)
    .get();
  if (!invSnap.exists) {
    return NextResponse.json({ ok: false, error: "Faktura neexistuje." }, { status: 404 });
  }
  const inv = { id: invSnap.id, ...invSnap.data() } as Record<string, unknown>;
  if (String(inv.jobId ?? "") !== jobId) {
    return NextResponse.json({ ok: false, error: "Faktura nepatří k zakázce." }, { status: 403 });
  }
  if (!isWorkBudgetSourceInvoice(inv)) {
    return NextResponse.json(
      { ok: false, error: "Faktura nevznikla z položkového rozpočtu." },
      { status: 400 }
    );
  }

  const gate = canSplitWorkBudgetInvoice(inv);
  if (!gate.allowed) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 400 });
  }

  const itemsSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .collection(WORK_BUDGET_ITEMS_COLLECTION)
    .get();
  const budgetCatalog = itemsSnap.docs.map((d) =>
    parseJobWorkBudgetItemFromFirestore(d.data() as Record<string, unknown>, d.id)
  );

  const lines = parseInvoiceLinesFromDoc(inv);
  const classification = classifyWorkBudgetInvoiceLines({
    lines,
    budgetCatalog,
    manualAssignments: body.manualAssignments,
  });
  if (classification.ambiguousLines.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Některé položky nelze automaticky zařadit.",
        ambiguousLineIds: classification.ambiguousLines.map((l) => l.id),
      },
      { status: 400 }
    );
  }

  try {
    const preview = buildWorkBudgetSplitPreview({
      inv,
      budgetCatalog,
      manualAssignments: body.manualAssignments,
    });
    return NextResponse.json({
      ok: true,
      preview: {
        originalInvoiceNumber: preview.originalInvoiceNumber,
        originalGross: preview.originalGross,
        baseGross: preview.baseGross,
        extraGross: preview.extraGross,
        baseDueGross: preview.baseDueGross,
        advanceDeductionGross: preview.advanceDeductionGross,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Validace selhala." },
      { status: 400 }
    );
  }
}
