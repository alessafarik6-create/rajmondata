import { NextRequest } from "next/server";
import {
  emailMailboxTenantOk,
  requireEmailMailboxWrite,
} from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { listEmailAccountsAccessibleToUser } from "@/lib/email-mailbox/account-access";
import { isEmailAccountSyncable } from "@/lib/email-mailbox/account-default";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const perm = await requireEmailMailboxWrite(request);
    if (!perm.ok) {
      return emailJsonErr({ status: perm.status, message: perm.error, error: perm.error });
    }
    let body: { companyId?: string; maxMessages?: number };
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const companyId =
      String(body.companyId ?? request.nextUrl.searchParams.get("companyId") ?? "").trim() ||
      perm.caller.companyId;
    if (!emailMailboxTenantOk(perm.caller, companyId)) {
      return emailJsonErr({ status: 403, message: "Neplatná organizace.", errorCode: "TENANT_MISMATCH" });
    }

    const accounts = await listEmailAccountsAccessibleToUser(perm.db, companyId, perm.caller.uid, "write");
    const syncable = accounts.filter((a) => isEmailAccountSyncable(a));
    let imported = 0;
    let errors = 0;
    let hasMore = false;
    const results: {
      accountId: string;
      email: string;
      success: boolean;
      newMessages: number;
      hasMore?: boolean;
      remaining?: number;
      error?: string;
      errorCode?: string;
    }[] = [];

    for (const acc of syncable) {
      const r = await syncEmailAccount(perm.db, companyId, acc.id, {
        batchSize: body.maxMessages ?? 25,
      });
      imported += r.imported;
      if (!r.success) errors++;
      if (r.hasMore) hasMore = true;
      results.push({
        accountId: acc.id,
        email: acc.email,
        success: r.success,
        newMessages: r.imported,
        hasMore: r.hasMore,
        remaining: r.remaining,
        error: r.error,
        errorCode: r.errorCode,
      });
    }

    const summaryParts = results.map((r) =>
      r.success
        ? `${r.email} – ${r.newMessages} nových`
        : `${r.email} – ${r.errorCode === "IMAP_AUTH_FAILED" ? "chyba přihlášení" : "chyba sync"}`
    );

    return emailJsonOk({
      accounts: syncable.length,
      imported,
      errors,
      hasMore,
      results,
      message:
        summaryParts.length > 0
          ? summaryParts.join("\n")
          : `Synchronizováno ${syncable.length} schránek – ${imported} nových zpráv.`,
    });
  } catch (err) {
    return emailRouteErrorResponse(err, "Synchronizace všech schránek selhala.");
  }
}
