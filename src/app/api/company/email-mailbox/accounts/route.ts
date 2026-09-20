import { NextRequest } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";
import {
  emailAccountsCol,
  findActivePersonalAccountByNormalizedEmail,
  saveEmailCredentials,
} from "@/lib/email-mailbox/account-store";
import {
  ensureUserDefaultAccountMigrated,
  listEmailAccountsAccessibleToUser,
} from "@/lib/email-mailbox/account-access";
import { normalizeMailboxEmail } from "@/lib/email-mailbox/account-default";
import {
  accountStatusLabel,
  displayEmailAccountStatus,
  resolveEmailCredentials,
} from "@/lib/email-mailbox/credential-resolver";
import { isEmailSyncStateStale } from "@/lib/email-mailbox/sync-timeout";
import {
  emailMailboxTenantOk,
  requireEmailMailboxRead,
  requireEmailMailboxWrite,
} from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import { isEmailCredentialsEncryptionConfigured } from "@/lib/email-mailbox/credential-crypto";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import { presetForProvider } from "@/lib/email-mailbox/provider-presets";
import { syncEmailAccount } from "@/lib/email-mailbox/sync-service";
import type { EmailAccountDoc, EmailProviderKind } from "@/lib/email-mailbox/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function formatAccountSafe(row: EmailAccountDoc & { id: string }) {
  const { id, ...a } = row;
  let lastSyncAt: string | null = null;
  try {
    const v = a.lastSyncAt as { toDate?: () => Date } | string | null | undefined;
    if (v && typeof v === "object" && typeof v.toDate === "function") {
      lastSyncAt = v.toDate().toISOString();
    } else if (typeof v === "string") {
      lastSyncAt = v;
    }
  } catch {
    lastSyncAt = null;
  }
  return {
    id,
    provider: a.provider,
    email: a.email,
    displayName: a.displayName ?? null,
    status: a.status,
    accountType: a.accountType ?? "PERSONAL",
    lastSyncAt,
    lastError: a.lastError ?? null,
    imapHost: a.imapHost,
    smtpHost: a.smtpHost,
    isDefault: Boolean(a.isDefault),
    isActive: a.isActive !== false,
    disconnected: a.status === "disconnected" || a.isActive === false,
  };
}

export async function GET(request: NextRequest) {
  try {
    const perm = await requireEmailMailboxRead(request);
    if (!perm.ok) {
      return emailJsonErr({
        status: perm.status,
        message: perm.error,
        error: perm.error,
        errorCode: perm.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      });
    }

    const db: Firestore = perm.db;
    const caller = perm.caller;

    const companyId =
      String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || caller.companyId;
    if (!emailMailboxTenantOk(caller, companyId)) {
      return emailJsonErr({
        status: 403,
        message: "Neplatná organizace.",
        errorCode: "TENANT_MISMATCH",
      });
    }
    await ensureUserDefaultAccountMigrated(db, companyId, caller.uid);
    const accounts = await listEmailAccountsAccessibleToUser(db, companyId, caller.uid, "read");
    const enriched = await Promise.all(
      accounts.map(async (row) => {
        const base = formatAccountSafe(row);
        const cred = await resolveEmailCredentials(db, companyId, row.id);
        const displayStatus = displayEmailAccountStatus(row.status, cred, row.updatedAt);
        if (
          (row.status === "syncing" && isEmailSyncStateStale(row.updatedAt)) ||
          (!cred.ok && (row.status === "connected" || row.status === "syncing"))
        ) {
          await emailAccountsCol(db, companyId)
            .doc(row.id)
            .update({
              status: displayStatus,
              lastError: cred.ok
                ? "Předchozí synchronizace nebyla dokončena."
                : cred.message.slice(0, 500),
              updatedAt: FieldValue.serverTimestamp(),
            })
            .catch(() => undefined);
        }
        return {
          ...base,
          status: displayStatus,
          statusLabel: accountStatusLabel(displayStatus),
          credentialReady: cred.ok,
          credentialErrorCode: cred.ok ? null : cred.errorCode,
          lastError: cred.ok ? base.lastError : cred.message,
        };
      })
    );
    return emailJsonOk({ accounts: enriched });
  } catch (err) {
    console.error("[email-mailbox/accounts GET]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Nepodařilo se načíst e-mailové účty.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireEmailMailboxWrite(request);
    if (!auth.ok) {
      return emailJsonErr({
        status: auth.status,
        message: auth.error,
        error: auth.error,
        errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      });
    }

    if (!isEmailCredentialsEncryptionConfigured()) {
      return emailJsonErr({
        status: 503,
        errorCode: "EMAIL_ENCRYPTION_NOT_CONFIGURED",
        message:
          "Server nemá nastaven šifrovací klíč EMAIL_CREDENTIALS_ENCRYPTION_KEY. Účet nelze bezpečně uložit.",
      });
    }

    let body: {
      companyId?: string;
      provider?: EmailProviderKind;
      email?: string;
      displayName?: string;
      password?: string;
      username?: string;
      imapHost?: string;
      imapPort?: number;
      imapSecure?: boolean;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      skipTest?: boolean;
      accountType?: "PERSONAL" | "SHARED";
    };
    try {
      body = await request.json();
    } catch {
      return emailJsonErr({ status: 400, message: "Neplatné tělo požadavku.", errorCode: "BAD_JSON" });
    }

    const companyId = String(body.companyId ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const username = String(body.username ?? body.email ?? "").trim();
    const provider = body.provider as EmailProviderKind;
    const password = String(body.password ?? "");
    if (!companyId || !email || !password || !provider) {
      return emailJsonErr({
        status: 400,
        message: "Vyplňte e-mail, heslo a provider.",
        errorCode: "VALIDATION",
      });
    }
    if (!emailMailboxTenantOk(auth.caller, companyId)) {
      return emailJsonErr({
        status: 403,
        message: "Neplatná organizace.",
        errorCode: "TENANT_MISMATCH",
      });
    }

    const accountType = body.accountType === "SHARED" ? "SHARED" : "PERSONAL";
    const normalizedEmail = normalizeMailboxEmail(email);

    if (accountType === "PERSONAL") {
      const dup = await findActivePersonalAccountByNormalizedEmail(
        auth.db,
        companyId,
        auth.caller.uid,
        normalizedEmail
      );
      if (dup) {
        return emailJsonErr({
          status: 409,
          message: "Tuto e-mailovou adresu už máte připojenou jako aktivní účet.",
          errorCode: "DUPLICATE_MAILBOX",
        });
      }
    }

    const existingUserAccounts = await listEmailAccountsAccessibleToUser(
      auth.db,
      companyId,
      auth.caller.uid,
      "read"
    );
    const activeCount = existingUserAccounts.filter(
      (a) => a.status !== "disconnected" && a.isActive !== false
    ).length;
    const makeDefault = activeCount === 0;

    const preset = presetForProvider(provider);
    if (!preset?.implemented) {
      return emailJsonErr({
        status: 400,
        message: "Provider zatím není dostupný.",
        errorCode: "PROVIDER_UNAVAILABLE",
      });
    }

    const accountDraft = {
      organizationId: companyId,
      userId: auth.caller.uid,
      accountType,
      provider,
      email,
      displayName: body.displayName?.trim() || null,
      status: "pending" as const,
      imapHost: body.imapHost?.trim() || preset.imapHost,
      imapPort: Number(body.imapPort ?? preset.imapPort),
      imapSecure: body.imapSecure ?? preset.imapSecure,
      smtpHost: body.smtpHost?.trim() || preset.smtpHost,
      smtpPort: Number(body.smtpPort ?? preset.smtpPort),
      smtpSecure: body.smtpSecure ?? preset.smtpSecure,
    };

    if (!accountDraft.imapHost || !accountDraft.smtpHost) {
      return emailJsonErr({
        status: 400,
        message: "Vyplňte IMAP a SMTP server.",
        errorCode: "VALIDATION",
      });
    }

    const { getEmailProviderAdapter } = await import("@/lib/email-mailbox/adapters");
    const adapter = getEmailProviderAdapter(provider);
    if (!adapter) {
      return emailJsonErr({
        status: 400,
        message: "Provider není implementován.",
        errorCode: "PROVIDER_UNAVAILABLE",
      });
    }

    if (!body.skipTest) {
      logEmailPhase("EMAIL_CONNECT_START", { companyId, email, userId: auth.caller.uid });
      const test = await adapter.testConnection(accountDraft, { username, password });
      if (!test.ok) {
        return emailJsonErr({
          status: 400,
          message: test.message ?? "Test připojení selhal.",
          errorCode: test.errorCode ?? "CONNECT_TEST_FAILED",
          extra: { test },
        });
      }
    }

    const accountId = crypto.randomUUID();
    await emailAccountsCol(auth.db, companyId).doc(accountId).set({
      ...accountDraft,
      normalizedEmail,
      isDefault: makeDefault,
      isActive: true,
      status: "connected",
      lastError: null,
      createdByUserId: auth.caller.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await saveEmailCredentials(auth.db, companyId, accountId, { username, password });

    await logEmailMailboxAudit(auth.db, companyId, {
      actionType: "email_account_connected",
      actionLabel: "Připojena e-mailová schránka",
      userId: auth.caller.uid,
      entityId: accountId,
      details: email,
      metadata: { provider, accountType },
    });

    const sync = await syncEmailAccount(auth.db, companyId, accountId, {
      maxMessages: 200,
      skipAi: false,
    });

    return emailJsonOk({
      accountId,
      sync,
      redirectTo: "/portal/email",
      message: !sync.success
        ? "Účet uložen, ale první synchronizace selhala."
        : `Schránka připojena. Synchronizováno – ${sync.imported} nových zpráv.`,
    });
  } catch (err) {
    logEmailPhase("EMAIL_CONNECT_ERROR", { phase: "connect_post" });
    console.error("[email-mailbox/accounts POST]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Nepodařilo se připojit e-mailovou schránku.");
  }
}
