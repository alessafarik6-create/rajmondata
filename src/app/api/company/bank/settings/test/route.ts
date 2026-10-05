import { NextRequest, NextResponse } from "next/server";
import { requireBankIntegrationAdmin, bankTenantOk } from "@/lib/bank/api-auth";
import { testBankConnectionForOrg } from "@/lib/bank/connection-store";
import { writeBankAuditLog } from "@/lib/bank/audit";
import { RbPremiumApiError } from "@/lib/bank/rb-premium-errors";
import { FieldValue } from "firebase-admin/firestore";
import { bankConnectionsCol } from "@/lib/bank/collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const perm = await requireBankIntegrationAdmin(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    const result = await testBankConnectionForOrg(perm.db, organizationId);
    await writeBankAuditLog(perm.db, {
      organizationId,
      userId: perm.caller.uid,
      action: "BANK_CONNECTION_UPDATED",
      metadata: { test: "ok", httpStatus: result.httpStatus },
    });
    return NextResponse.json({
      ok: true,
      httpStatus: result.httpStatus,
      message: result.message,
      display: result.display,
      requestUrl: result.requestUrl,
      accountsFound: result.accountsFound,
    });
  } catch (e) {
    if (e instanceof RbPremiumApiError) {
      await bankConnectionsCol(perm.db, organizationId).doc("raiffeisen").set(
        {
          status: e.httpStatus === 401 || e.httpStatus === 403 ? "auth_error" : "error",
          lastSyncError: e.display.slice(0, 500),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      const status =
        e.httpStatus >= 400 && e.httpStatus <= 599 ? e.httpStatus : 502;
      return NextResponse.json(
        {
          ok: false,
          httpStatus: e.httpStatus,
          error: e.rbError ?? null,
          errorDescription: e.rbErrorDescription ?? null,
          message: e.userMessage,
          display: e.display,
          requestUrl: e.requestUrl,
        },
        { status }
      );
    }
    const msg = e instanceof Error ? e.message : "Test spojení selhal.";
    return NextResponse.json({ ok: false, error: msg, message: msg }, { status: 400 });
  }
}
