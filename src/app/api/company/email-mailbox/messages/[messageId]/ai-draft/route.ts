import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { suggestEmailReplyDraft } from "@/lib/email-mailbox/ai-analyze-message";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";

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
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const { messageId } = await ctx.params;

  const access = await assertMessageAccess(perm.db, companyId, messageId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const m = access.message;
  const draft = await suggestEmailReplyDraft(m);
  if (!draft) {
    return NextResponse.json({ ok: false, error: "AI návrh není k dispozici." }, { status: 503 });
  }

  await perm.db
    .collection("companies")
    .doc(companyId)
    .collection("email_messages")
    .doc(messageId)
    .update({
      aiDraftReply: draft,
      updatedAt: FieldValue.serverTimestamp(),
    });

  await logEmailMailboxAudit(perm.db, companyId, {
    actionType: "email_ai_draft",
    actionLabel: "AI návrh odpovědi na e-mail",
    userId: perm.caller.uid,
    entityId: messageId,
  });

  return NextResponse.json({ ok: true, draft });
}
