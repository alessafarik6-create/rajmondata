import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";

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
  const { id, ...mRest } = access.message;
  return NextResponse.json({
    ok: true,
    message: {
      id: id ?? messageId,
      ...mRest,
      receivedAt: mRest.receivedAt?.toDate?.()?.toISOString?.() ?? null,
      sentAt: mRest.sentAt?.toDate?.()?.toISOString?.() ?? null,
      textBody: mRest.textBody,
      htmlBody: mRest.htmlBody,
      aiDraftReply: mRest.aiDraftReply ?? null,
      inquiryDraft: mRest.inquiryDraft ?? null,
      suggestedActions: mRest.suggestedActions ?? [],
      jobVisibility: mRest.jobVisibility ?? "private",
    },
  });
}
