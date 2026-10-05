import { NextRequest, NextResponse } from "next/server";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { syncBankForOrganization } from "@/lib/bank/sync-service";
import { RbPremiumApiError } from "@/lib/bank/rb-premium-errors";
import { BankSyncPartialError } from "@/lib/bank/bank-sync-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const runtime = "nodejs";

function rbErrorResponse(e: RbPremiumApiError) {
  const status =
    e.httpStatus >= 400 && e.httpStatus <= 599 ? e.httpStatus : 502;
  const diagnostics =
    process.env.NODE_ENV !== "production" || process.env.RB_SYNC_DIAGNOSTICS === "1";
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: "RB_REQUEST_REJECTED",
      stage: e.stage ?? null,
      upstreamStatus: e.httpStatus,
      requestId: e.requestId ?? null,
      source: e.source,
      httpStatus: e.httpStatus,
      rbError: e.rbError ?? null,
      errorDescription: e.rbErrorDescription ?? null,
      message: e.userMessage,
      display: e.display,
      requestUrl: diagnostics ? e.requestUrl : undefined,
    },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    const result = await syncBankForOrganization(perm.db, organizationId, perm.caller.uid);
    return NextResponse.json({
      ok: true,
      success: true,
      accountsImported: result.accounts,
      transactionsImported: result.imported,
      transactionsUpdated: result.updated,
      lastSyncAt: result.lastSyncAt,
      accounts: result.accounts,
      imported: result.imported,
      updated: result.updated,
    });
  } catch (e) {
    if (e instanceof BankSyncPartialError) {
      const rb = e.rbError;
      const status =
        rb.httpStatus >= 400 && rb.httpStatus <= 599 ? rb.httpStatus : 400;
      return NextResponse.json(
        {
          ok: false,
          success: false,
          partialSuccess: true,
          accountsImported: e.result.accounts,
          transactionsImported: e.result.imported,
          transactionsUpdated: e.result.updated,
          lastSyncAt: e.result.lastSyncAt,
          accountsSuccess: true,
          transactionsSuccess: false,
          error: "RB_TRANSACTIONS_REJECTED",
          stage: "transactions",
          upstreamStatus: rb.httpStatus,
          requestId: rb.requestId ?? null,
          message: e.userMessage,
          display: rb.display,
        },
        { status }
      );
    }
    if (e instanceof RbPremiumApiError) {
      return rbErrorResponse(e);
    }
    const msg = e instanceof Error ? e.message : "Synchronizace selhala.";
    return NextResponse.json(
      { ok: false, success: false, error: msg, message: msg },
      { status: 500 }
    );
  }
}
