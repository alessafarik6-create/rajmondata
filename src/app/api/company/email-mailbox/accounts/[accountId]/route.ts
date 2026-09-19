import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireOrgEmailAdmin } from "@/lib/email-mailbox/api-auth";
import { emailAccountsCol, saveEmailCredentials } from "@/lib/email-mailbox/account-store";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ accountId: string }> };

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requireOrgEmailAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? "").trim();
  const { accountId } = await ctx.params;
  if (!companyId) return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });

  await emailAccountsCol(auth.db, companyId).doc(accountId).delete();
  await logEmailMailboxAudit(auth.db, companyId, {
    actionType: "email_account_disconnected",
    actionLabel: "Odpojena e-mailová schránka",
    userId: auth.caller.uid,
    entityId: accountId,
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireOrgEmailAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const { accountId } = await ctx.params;

  let body: { companyId?: string; displayName?: string; password?: string; test?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId) return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });

  const ref = emailAccountsCol(auth.db, companyId).doc(accountId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: "Účet nenalezen." }, { status: 404 });
  const account = snap.data()!;

  if (body.displayName != null) {
    await ref.update({ displayName: body.displayName.trim(), updatedAt: FieldValue.serverTimestamp() });
  }

  if (body.password) {
    const { getEmailProviderAdapter } = await import("@/lib/email-mailbox/adapters");
    const adapter = getEmailProviderAdapter(account.provider as never);
    if (adapter && body.test !== false) {
      const test = await adapter.testConnection(account as never, {
        username: account.email,
        password: body.password,
      });
      if (!test.ok) {
        return NextResponse.json({ ok: false, error: test.message, test }, { status: 400 });
      }
    }
    await saveEmailCredentials(auth.db, companyId, accountId, {
      username: account.email,
      password: body.password,
    });
    await ref.update({ status: "connected", lastError: null, updatedAt: FieldValue.serverTimestamp() });
  }

  return NextResponse.json({ ok: true });
}
