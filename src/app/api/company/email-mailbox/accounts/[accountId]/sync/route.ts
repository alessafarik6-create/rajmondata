import { NextRequest } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ accountId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const perm = await requireEmailMailboxWrite(request);
    if (!perm.ok) {
      return emailJsonErr({
        status: perm.status,
        message: perm.error,
        error: perm.error,
        errorCode: perm.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      });
    }
    const db = getAdminFirestore();
    if (!db) {
      return emailJsonErr({
        status: 503,
        message: "Firestore není k dispozici.",
        errorCode: "SERVER_CONFIG",
      });
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
      return emailJsonErr({
        status: 403,
        message: "Neplatná organizace.",
        errorCode: "TENANT_MISMATCH",
      });
    }
    const { accountId } = await ctx.params;

    const result = await syncEmailAccount(db, companyId, accountId, {
      maxMessages: body.maxMessages ?? 100,
    });

    if (result.error) {
      return emailJsonErr({
        status: 400,
        message:
          result.errorCode === "IMAP_AUTH_FAILED"
            ? "Nelze se přihlásit k IMAP. Zkontrolujte e-mail, heslo aplikace a nastavení Seznam.cz."
            : result.error,
        errorCode: result.errorCode ?? "SYNC_FAILED",
        extra: { imported: result.imported, skipped: result.skipped },
      });
    }

    return emailJsonOk({
      ...result,
      message: `Synchronizováno – ${result.imported} nových zpráv.`,
    });
  } catch (err) {
    console.error("[email-mailbox/sync]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Synchronizace selhala.");
  }
}
