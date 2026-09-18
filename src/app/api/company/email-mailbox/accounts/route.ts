import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import crypto from "node:crypto";
import {
  emailAccountsCol,
  listEmailAccounts,
  saveEmailCredentials,
} from "@/lib/email-mailbox/account-store";
import {
  emailMailboxTenantOk,
  requireEmailMailboxRead,
  requireOrgEmailAdmin,
} from "@/lib/email-mailbox/api-auth";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { getEmailProviderAdapter } from "@/lib/email-mailbox/adapters";
import { presetForProvider } from "@/lib/email-mailbox/provider-presets";
import type { EmailProviderKind } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const accounts = await listEmailAccounts(perm.db, companyId);
  const safe = accounts.map(({ id, ...a }) => ({
    id,
    provider: a.provider,
    email: a.email,
    displayName: a.displayName ?? null,
    status: a.status,
    lastSyncAt: a.lastSyncAt?.toDate?.()?.toISOString?.() ?? null,
    lastError: a.lastError ?? null,
    imapHost: a.imapHost,
    smtpHost: a.smtpHost,
  }));
  return NextResponse.json({ ok: true, accounts: safe });
}

export async function POST(request: NextRequest) {
  const auth = await requireOrgEmailAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

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
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const username = String(body.username ?? body.email ?? "").trim();
  const provider = body.provider as EmailProviderKind;
  const password = String(body.password ?? "");
  if (!companyId || !email || !password || !provider) {
    return NextResponse.json({ ok: false, error: "Vyplňte e-mail, heslo a provider." }, { status: 400 });
  }
  if (!emailMailboxTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const preset = presetForProvider(provider);
  if (!preset?.implemented) {
    return NextResponse.json({ ok: false, error: "Provider zatím není dostupný." }, { status: 400 });
  }

  const accountDraft = {
    organizationId: companyId,
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
    return NextResponse.json({ ok: false, error: "Vyplňte IMAP a SMTP server." }, { status: 400 });
  }

  const adapter = getEmailProviderAdapter(provider);
  if (!adapter) {
    return NextResponse.json({ ok: false, error: "Provider není implementován." }, { status: 400 });
  }

  if (!body.skipTest) {
    const test = await adapter.testConnection(accountDraft, { username, password });
    if (!test.ok) {
      return NextResponse.json({ ok: false, error: test.message ?? "Test připojení selhal.", test }, { status: 400 });
    }
  }

  const accountId = crypto.randomUUID();
  await emailAccountsCol(auth.db, companyId).doc(accountId).set({
    ...accountDraft,
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
    metadata: { provider },
  });

  return NextResponse.json({ ok: true, accountId });
}
