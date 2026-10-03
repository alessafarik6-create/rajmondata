import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireBankRead, requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { bankAccountsCol } from "@/lib/bank/collections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireBankRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const snap = await bankAccountsCol(perm.db, organizationId).get();
  const accounts = snap.docs.map((d) => {
    const a = d.data();
    return {
      id: d.id,
      name: a.name,
      accountNumber: a.accountNumber,
      iban: a.iban,
      currency: a.currency,
      balance: a.balance,
      availableBalance: a.availableBalance,
      isActive: a.isActive !== false,
    };
  });
  return NextResponse.json({ ok: true, accounts });
}

export async function PATCH(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    accountId?: string;
    isActive?: boolean;
  };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Chybí účet." }, { status: 400 });
  }
  await bankAccountsCol(perm.db, organizationId).doc(accountId).set(
    {
      isActive: body.isActive !== false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return NextResponse.json({ ok: true });
}
