import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import {
  buildMessageViewFilter,
  messageIsStaleNeedsReply,
} from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc, EmailMessageWorkflowView } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  const view = (request.nextUrl.searchParams.get("view") ??
    "inbox") as EmailMessageWorkflowView;
  const accountId = request.nextUrl.searchParams.get("accountId");

  const snap = await emailMessagesCol(perm.db, companyId).orderBy("receivedAt", "desc").limit(120).get();
  const filterFn = buildMessageViewFilter(view);
  const messages = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }))
    .filter((m) => (accountId ? m.emailAccountId === accountId : true))
    .filter(filterFn)
    .map((m) => ({
      id: m.id,
      emailAccountId: m.emailAccountId,
      from: m.from,
      subject: m.subject,
      receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() ?? null,
      needsReply: m.needsReply,
      staleNeedsReply: messageIsStaleNeedsReply(m),
      aiSummary: m.aiSummary ?? null,
      aiClassification: m.aiClassification ?? null,
      aiPriority: m.aiPriority ?? null,
      customerId: m.customerId ?? null,
      jobId: m.jobId ?? null,
      inquiryId: m.inquiryId ?? null,
      resolved: Boolean(m.resolved),
      aiReviewPending: Boolean(m.aiReviewPending),
      direction: m.direction,
      isRead: Boolean(m.isRead),
      customerName: m.customerName ?? null,
      jobLabel: m.jobLabel ?? null,
    }));

  return NextResponse.json({ ok: true, view, messages });
}
