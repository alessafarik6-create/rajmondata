import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import {
  resolvePreliminaryDealEmployeeName,
  sanitizePreliminaryDealInput,
} from "@/lib/leads/preliminary-deal-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "leads",
    method: "POST",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const patch = sanitizePreliminaryDealInput(body);
  if (!patch.title?.trim()) {
    return NextResponse.json({ ok: false, error: "Název zakázky je povinný." }, { status: 400 });
  }
  if (!patch.description?.trim()) {
    return NextResponse.json({ ok: false, error: "Stručný popis práce je povinný." }, { status: 400 });
  }
  const price = Number(patch.priceAmount ?? body.priceAmount);
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ ok: false, error: "Předběžná cena musí být platné číslo." }, { status: 400 });
  }

  const responsibleEmployeeId =
    patch.responsibleEmployeeId !== undefined
      ? patch.responsibleEmployeeId
      : v.caller.employeeId ?? null;
  const responsibleEmployeeName = responsibleEmployeeId
    ? await resolvePreliminaryDealEmployeeName(v.db, companyId, responsibleEmployeeId)
    : null;

  const ref = v.db.collection("companies").doc(companyId).collection("preliminary_deals").doc();
  const doc = {
    companyId,
    title: patch.title.trim(),
    description: patch.description.trim(),
    priceAmount: price,
    priceVatMode: patch.priceVatMode ?? "with_vat",
    status: patch.status ?? "predjednano",
    customerId: patch.customerId ?? null,
    customerName: patch.customerName ?? null,
    customerPhone: patch.customerPhone ?? null,
    customerEmail: patch.customerEmail ?? null,
    expectedCompletionDate: patch.expectedCompletionDate ?? null,
    expectedConfirmationDate: patch.expectedConfirmationDate ?? null,
    note: patch.note ?? null,
    responsibleEmployeeId,
    responsibleEmployeeName,
    sourceLeadId: patch.sourceLeadId ?? null,
    convertedJobId: null,
    attachments: patch.attachments ?? [],
    createdBy: v.caller.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: v.caller.uid,
  };

  await ref.set(doc);
  return NextResponse.json({ ok: true, dealId: ref.id });
}
