import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import {
  EMAIL_WORKFLOW_STATES,
  type EmailWorkflowState,
} from "@/lib/email-mailbox/intelligence-types";
import { appendEmailMessageTimeline } from "@/lib/email-mailbox/message-timeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    workflowState?: EmailWorkflowState;
    resolved?: boolean;
    aiPriority?: string;
    aiCategory?: string;
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

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (body.workflowState && EMAIL_WORKFLOW_STATES.includes(body.workflowState)) {
    patch.workflowState = body.workflowState;
  }
  if (typeof body.resolved === "boolean") {
    patch.resolved = body.resolved;
    if (body.resolved) {
      patch.workflowState = "resolved";
      patch.requiresAction = false;
    }
  }
  if (body.aiPriority) patch.aiPriority = body.aiPriority;
  if (body.aiCategory) {
    patch.aiCategory = body.aiCategory;
    patch.aiClassification = body.aiCategory;
  }

  await emailMessagesCol(perm.db, companyId).doc(messageId).update(patch);

  if (body.resolved) {
    await appendEmailMessageTimeline(perm.db, companyId, messageId, {
      kind: "resolved",
      label: "Vyřešeno",
      userId: perm.caller.uid,
    });
  }

  return NextResponse.json({ ok: true });
}
