import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
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
  const { messageId } = await ctx.params;
  const snap = await emailMessagesCol(perm.db, companyId).doc(messageId).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Zpráva nenalezena." }, { status: 404 });
  }
  const m = snap.data() as EmailMessageDoc;
  return NextResponse.json({
    ok: true,
    message: {
      id: messageId,
      ...m,
      receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() ?? null,
      sentAt: m.sentAt?.toDate?.()?.toISOString?.() ?? null,
      textBody: m.textBody,
      htmlBody: m.htmlBody,
      aiDraftReply: m.aiDraftReply ?? null,
      inquiryDraft: m.inquiryDraft ?? null,
      suggestedActions: m.suggestedActions ?? [],
    },
  });
}
