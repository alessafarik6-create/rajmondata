import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { suggestEmailReplyDraft } from "@/lib/email-mailbox/ai-analyze-message";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ messageId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
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
  const draft = await suggestEmailReplyDraft(m);
  if (!draft) {
    return NextResponse.json({ ok: false, error: "AI návrh není k dispozici." }, { status: 503 });
  }

  await snap.ref.update({
    aiDraftReply: draft,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, draft });
}
