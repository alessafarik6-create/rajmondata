import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { sanitizePreliminaryDealInput } from "@/lib/leads/preliminary-deal-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "leads",
    method: "PATCH",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const { dealId } = await ctx.params;
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

  const ref = v.db.collection("companies").doc(companyId).collection("preliminary_deals").doc(dealId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Záznam nenalezen." }, { status: 404 });
  }

  const patch = sanitizePreliminaryDealInput(body);
  if (patch.title !== undefined && !patch.title.trim()) {
    return NextResponse.json({ ok: false, error: "Název nesmí být prázdný." }, { status: 400 });
  }

  await ref.set(
    {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: v.caller.uid,
    },
    { merge: true }
  );
  return NextResponse.json({ ok: true, dealId });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const v = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "leads",
    method: "DELETE",
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const { dealId } = await ctx.params;
  const url = new URL(request.url);
  const companyId = String(url.searchParams.get("companyId") ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const ref = v.db.collection("companies").doc(companyId).collection("preliminary_deals").doc(dealId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Záznam nenalezen." }, { status: 404 });
  }
  await ref.delete();
  return NextResponse.json({ ok: true });
}
