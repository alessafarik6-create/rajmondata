import { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  assertEmailAccountAccess,
  disconnectEmailAccountSoft,
  setDefaultEmailAccountForUser,
} from "@/lib/email-mailbox/account-access";
import {
  emailMailboxTenantOk,
  requireEmailMailboxWrite,
} from "@/lib/email-mailbox/api-auth";
import {
  emailAccountsCol,
  saveEmailCredentials,
} from "@/lib/email-mailbox/account-store";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { isEmailCredentialsEncryptionConfigured } from "@/lib/email-mailbox/credential-crypto";
import { EMAIL_CREDENTIALS_ENCRYPTION_KEY_ENV } from "@/lib/email-mailbox/credential-resolver";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";
import { isEmailAccountSyncable } from "@/lib/email-mailbox/account-default";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ accountId: string }> };

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireEmailMailboxWrite(request);
    if (!auth.ok) {
      return emailJsonErr({ status: auth.status, message: auth.error, errorCode: "FORBIDDEN" });
    }
    const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
    const { accountId } = await ctx.params;
    if (!companyId) {
      return emailJsonErr({ status: 400, message: "Chybí companyId.", errorCode: "VALIDATION" });
    }
    if (!emailMailboxTenantOk(auth.caller, companyId)) {
      return emailJsonErr({ status: 403, message: "Neplatná organizace.", errorCode: "TENANT_MISMATCH" });
    }

    const disconnected = await disconnectEmailAccountSoft(auth.db, companyId, accountId, auth.caller.uid);
    if (!disconnected.ok) {
      return emailJsonErr({
        status: disconnected.status,
        message: disconnected.error,
        errorCode: disconnected.errorCode,
      });
    }

    await logEmailMailboxAudit(auth.db, companyId, {
      actionType: "email_account_disconnected",
      actionLabel: "Odpojena e-mailová schránka (soft)",
      userId: auth.caller.uid,
      entityId: accountId,
    });
    return emailJsonOk({
      message: "Účet je odpojený. Historická komunikace zůstala zachována.",
    });
  } catch (err) {
    return emailRouteErrorResponse(err, "Nepodařilo se odpojit účet.");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireEmailMailboxWrite(request);
    if (!auth.ok) {
      return emailJsonErr({ status: auth.status, message: auth.error, errorCode: "FORBIDDEN" });
    }
    const { accountId } = await ctx.params;

    let body: {
      companyId?: string;
      displayName?: string;
      password?: string;
      username?: string;
      test?: boolean;
      runSync?: boolean;
      setDefault?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return emailJsonErr({ status: 400, message: "Neplatné tělo.", errorCode: "BAD_JSON" });
    }
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return emailJsonErr({ status: 400, message: "Chybí companyId.", errorCode: "VALIDATION" });
    }
    if (!emailMailboxTenantOk(auth.caller, companyId)) {
      return emailJsonErr({ status: 403, message: "Neplatná organizace.", errorCode: "TENANT_MISMATCH" });
    }

    const access = await assertEmailAccountAccess(auth.db, companyId, accountId, auth.caller.uid, "write");
    if (!access.ok) {
      return emailJsonErr({
        status: access.status,
        message: access.error,
        errorCode: access.errorCode,
      });
    }
    const account = access.account;
    const ref = emailAccountsCol(auth.db, companyId).doc(accountId);

    if (body.setDefault === true) {
      const r = await setDefaultEmailAccountForUser(auth.db, companyId, auth.caller.uid, accountId);
      if (!r.ok) {
        return emailJsonErr({ status: 400, message: r.error, errorCode: "SET_DEFAULT_FAILED" });
      }
      return emailJsonOk({ message: "Výchozí schránka byla nastavena." });
    }

    if (body.displayName != null) {
      await ref.update({ displayName: body.displayName.trim(), updatedAt: FieldValue.serverTimestamp() });
    }

    if (body.password) {
      if (!isEmailAccountSyncable(account)) {
        return emailJsonErr({
          status: 400,
          message: "Odpojený účet — nejdříve připojte nový účet se stejnou adresou.",
          errorCode: "ACCOUNT_DISCONNECTED",
        });
      }
      if (!isEmailCredentialsEncryptionConfigured()) {
        return emailJsonErr({
          status: 503,
          errorCode: "EMAIL_ENCRYPTION_KEY_MISSING",
          message: `Server nemá nastaven ${EMAIL_CREDENTIALS_ENCRYPTION_KEY_ENV}.`,
        });
      }

      const username = String(body.username ?? account.email ?? "").trim() || String(account.email);
      const { getEmailProviderAdapter } = await import("@/lib/email-mailbox/adapters");
      const adapter = getEmailProviderAdapter(account.provider as never);
      if (adapter && body.test !== false) {
        logEmailPhase("EMAIL_CONNECT_START", { accountId, email: account.email, reauth: true });
        const test = await adapter.testConnection(account as never, {
          username,
          password: body.password,
        });
        if (!test.ok) {
          return emailJsonErr({
            status: 400,
            message: test.message ?? "Test připojení selhal.",
            errorCode: test.errorCode ?? "CONNECT_TEST_FAILED",
            extra: { test },
          });
        }
      }

      await saveEmailCredentials(auth.db, companyId, accountId, {
        username,
        password: body.password,
      });
      await ref.update({
        status: "connected",
        isActive: true,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      let sync: Awaited<ReturnType<typeof syncEmailAccount>> | undefined;
      if (body.runSync !== false) {
        sync = await syncEmailAccount(auth.db, companyId, accountId, { maxMessages: 100 });
      }

      return emailJsonOk({
        message: "Přihlašovací údaje byly uloženy.",
        sync: sync ?? null,
      });
    }

    return emailJsonOk({});
  } catch (err) {
    logEmailPhase("EMAIL_CONNECT_ERROR", { phase: "patch_reauth" });
    return emailRouteErrorResponse(err, "Nepodařilo se uložit nastavení účtu.");
  }
}
