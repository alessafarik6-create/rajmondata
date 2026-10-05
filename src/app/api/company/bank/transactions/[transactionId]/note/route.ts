import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { bankTransactionsCol } from "@/lib/bank/collections";
import { writeBankAuditLog } from "@/lib/bank/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ transactionId: string }> }
) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { transactionId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { companyId?: string; note?: string };
  const organizationId =
    String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const note = String(body.note ?? "").trim().slice(0, 2000);
  const txnRef = bankTransactionsCol(perm.db, organizationId).doc(transactionId);
  const snap = await txnRef.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Transakce nenalezena." }, { status: 404 });
  }
  const txn = snap.data() as Record<string, unknown>;
  if (String(txn.organizationId) !== organizationId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const now = new Date().toISOString();
  await txnRef.update({
    note: note || null,
    noteUpdatedAt: now,
    noteUpdatedByUserId: perm.caller.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeBankAuditLog(perm.db, {
    organizationId,
    userId: perm.caller.uid,
    action: "BANK_TRANSACTION_NOTE_UPDATED",
    entityId: transactionId,
    metadata: { noteLength: note.length },
  });

  return NextResponse.json({
    ok: true,
    note,
    noteUpdatedAt: now,
    noteUpdatedByUserId: perm.caller.uid,
  });
}
