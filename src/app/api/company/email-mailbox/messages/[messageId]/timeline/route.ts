import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { EMAIL_SUBCOLLECTION_MESSAGE_TIMELINE } from "@/lib/email-mailbox/intelligence-types";

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

  const snap = await emailMessagesCol(perm.db, companyId)
    .doc(messageId)
    .collection(EMAIL_SUBCOLLECTION_MESSAGE_TIMELINE)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get()
    .catch(async () =>
      emailMessagesCol(perm.db, companyId)
        .doc(messageId)
        .collection(EMAIL_SUBCOLLECTION_MESSAGE_TIMELINE)
        .limit(50)
        .get()
    );

  const events = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      kind: data.kind,
      label: data.label,
      userId: data.userId ?? null,
      metadata: data.metadata ?? null,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
    };
  });

  return NextResponse.json({ ok: true, events });
}
