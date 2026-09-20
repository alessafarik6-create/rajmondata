import { NextRequest } from "next/server";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { messageForCredentialError } from "@/lib/email-mailbox/credential-resolver";
import type { EmailCredentialErrorCode } from "@/lib/email-mailbox/credential-resolver";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { assertEmailAccountAccess } from "@/lib/email-mailbox/account-access";

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

    const access = await assertEmailAccountAccess(db, companyId, accountId, perm.caller.uid, "write");
    if (!access.ok) {
      return emailJsonErr({
        status: access.status,
        message: access.error,
        errorCode: access.errorCode,
      });
    }
    const { isEmailAccountSyncable } = await import("@/lib/email-mailbox/account-default");
    if (!isEmailAccountSyncable(access.account)) {
      return emailJsonErr({
        status: 400,
        message: "Odpojený účet nelze synchronizovat.",
        errorCode: "ACCOUNT_DISCONNECTED",
      });
    }

    const result = await syncEmailAccount(db, companyId, accountId, {
      maxMessages: body.maxMessages ?? 100,
    });

    if (!result.success || result.error) {
      const code = result.errorCode ?? "SYNC_FAILED";
      const credentialCodes: EmailCredentialErrorCode[] = [
        "EMAIL_ENCRYPTION_KEY_MISSING",
        "EMAIL_CREDENTIAL_MISSING",
        "EMAIL_CREDENTIAL_DECRYPT_FAILED",
      ];
      const message = credentialCodes.includes(code as EmailCredentialErrorCode)
        ? messageForCredentialError(code as EmailCredentialErrorCode)
        : code === "EMAIL_IMAP_AUTH_FAILED" || code === "IMAP_AUTH_FAILED"
          ? "Přihlášení k e-mailové schránce selhalo."
          : result.error ?? "Synchronizace selhala.";
      return emailJsonErr({
        status: 400,
        message,
        errorCode: code,
        extra: {
          success: false,
          newMessages: result.imported,
          accountId,
          imported: result.imported,
          skipped: result.skipped,
        },
      });
    }

    return emailJsonOk({
      success: true,
      newMessages: result.imported,
      accountId,
      lastSyncAt: result.lastSyncAt ?? new Date().toISOString(),
      imported: result.imported,
      skipped: result.skipped,
      message: `Synchronizováno – ${result.imported} nových zpráv.`,
    });
  } catch (err) {
    console.error("[email-mailbox/sync]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Synchronizace selhala.");
  }
}
