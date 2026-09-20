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
  let toneBody: { tone?: "default" | "shorter" | "formal" | "friendly" } = {};
  try {
    toneBody = await request.json();
  } catch {
    toneBody = {};
  }

  const m = access.message;
  const threadRes = await perm.db
    .collection("companies")
    .doc(companyId)
    .collection("email_messages")
    .where("threadId", "==", m.threadId ?? "__none__")
    .limit(15)
    .get()
    .catch(() => null);
  const threadContext =
    threadRes && !threadRes.empty
      ? threadRes.docs
          .map((d) => d.data() as { from?: string; textBody?: string })
          .map((row) => `${row.from ?? "?"}: ${String(row.textBody ?? "").slice(0, 400)}`)
          .join("\n---\n")
      : undefined;

  const draft = await suggestEmailReplyDraft(m, {
    tone: toneBody.tone,
    threadContext,
  });
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

  const { appendEmailMessageTimeline } = await import("@/lib/email-mailbox/message-timeline");
  await appendEmailMessageTimeline(perm.db, companyId, messageId, {
    kind: "ai_draft",
    label: "AI vytvořila návrh odpovědi",
    userId: perm.caller.uid,
  });

  await logEmailMailboxAudit(perm.db, companyId, {
    actionType: "email_ai_draft",
    actionLabel: "AI návrh odpovědi na e-mail",
    userId: perm.caller.uid,
    entityId: messageId,
  });

  return NextResponse.json({ ok: true, draft });
}
