import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import {
  assertMessageAccess,
  loadAccessibleAccountIdSet,
  messageBelongsToUser,
} from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { messageId } = await ctx.params;
  const access = await assertMessageAccess(perm.db, companyId, messageId, perm.caller.uid, "read");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const root = access.message;
  const threadId = root.threadId;
  if (!threadId) {
    return NextResponse.json({
      ok: true,
      thread: [
        {
          id: messageId,
          direction: root.direction,
          from: root.from,
          subject: root.subject,
          textBody: root.textBody,
          receivedAt: root.receivedAt?.toDate?.()?.toISOString?.() ?? null,
        },
      ],
    });
  }

  const accessibleIds = await loadAccessibleAccountIdSet(perm.db, companyId, perm.caller.uid);
  const snap = await emailMessagesCol(perm.db, companyId)
    .where("threadId", "==", threadId)
    .limit(40)
    .get();

  const thread = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }))
    .filter((m) => messageBelongsToUser(m, perm.caller.uid, accessibleIds))
    .sort(
      (a, b) =>
        (a.receivedAt?.toMillis?.() ?? a.sentAt?.toMillis?.() ?? 0) -
        (b.receivedAt?.toMillis?.() ?? b.sentAt?.toMillis?.() ?? 0)
    )
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      from: m.from,
      subject: m.subject,
      textBody: m.textBody,
      receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() ?? null,
      sentAt: m.sentAt?.toDate?.()?.toISOString?.() ?? null,
    }));

  return NextResponse.json({ ok: true, thread });
}
