import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { canManagePortalInvoices } from "@/lib/portal-invoice-permissions";
import {
  recordPortalInvoicePaymentAdmin,
  type InvoicePaymentMethod,
} from "@/lib/portal-invoice-record-payment-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ invoiceId: string }> };

const METHODS: InvoicePaymentMethod[] = ["bank", "cash", "card", "other"];

export async function POST(request: NextRequest, { params }: Params) {
  const v = await verifyCompanyBearerWithPortalAccess(
    request.headers.get("authorization"),
    { moduleId: "documents", method: "POST" }
  );
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  if (!canManagePortalInvoices(v.caller.role)) {
    return NextResponse.json(
      { ok: false, error: "Nemáte oprávnění zapisovat úhrady faktur." },
      { status: 403 }
    );
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: "Serverová databáze není k dispozici." },
      { status: 503 }
    );
  }

  const { invoiceId } = await params;
  let body: {
    companyId?: string;
    amount?: number;
    paidAt?: string;
    method?: string;
    note?: string;
    settleRemaining?: boolean;
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

  const methodRaw = String(body.method ?? "bank").trim().toLowerCase();
  const method = (METHODS.includes(methodRaw as InvoicePaymentMethod)
    ? methodRaw
    : "bank") as InvoicePaymentMethod;

  try {
    const result = await recordPortalInvoicePaymentAdmin(db, {
      organizationId: companyId,
      invoiceId,
      userId: v.caller.uid,
      amount: Number(body.amount),
      paidAt:
        String(body.paidAt ?? "").trim() ||
        new Date().toISOString().split("T")[0],
      method,
      note: body.note ?? null,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Úhradu se nepodařilo uložit.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
