import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    isRead?: boolean;
    deleted?: boolean;
    resolved?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { messageId } = await ctx.params;
  const access = await assertMessageAccess(perm.db, companyId, messageId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const ref = emailMessagesCol(perm.db, companyId).doc(messageId);
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof body.isRead === "boolean") patch.isRead = body.isRead;
  if (typeof body.deleted === "boolean") patch.deleted = body.deleted;
  if (typeof body.resolved === "boolean") patch.resolved = body.resolved;

  await ref.update(patch);

  if (body.deleted) {
    await logEmailMailboxAudit(perm.db, companyId, {
      actionType: "email_message_deleted",
      actionLabel: "E-mail přesunut do koše",
      userId: perm.caller.uid,
      entityId: messageId,
    });
  }

  return NextResponse.json({ ok: true });
}
