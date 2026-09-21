import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { loadUserEmailDashboardSnapshot } from "@/lib/email-mailbox/user-mailbox-context";
import { emailMessagesCol, computeDashboardEmailStats } from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";
import { messageVisibleToUser } from "@/lib/email-mailbox/message-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const loaded = await loadUserEmailDashboardSnapshot({
    db: perm.db,
    organizationId: companyId,
    userId: perm.caller.uid,
    hasEmailPortalRead: true,
    messageLimit: 200,
  });
  if (!loaded.ok) {
    return NextResponse.json({
      ok: true,
      waitingReply: 0,
      overdue: 0,
      assignedToMe: 0,
      urgent: 0,
      assignedToJobs: 0,
      aiImportant: 0,
      mailboxStatus: loaded.context.code,
    });
  }

  const mailboxIds = new Set([loaded.mailbox.mailboxId]);
  const snap = await emailMessagesCol(perm.db, companyId).orderBy("receivedAt", "desc").limit(200).get();
  const rows = snap.docs
    .map((d) => d.data() as EmailMessageDoc)
    .filter((m) => messageVisibleToUser(m, perm.caller.uid, mailboxIds));

  const dash = computeDashboardEmailStats(rows, perm.caller.uid);
  let assignedToJobs = 0;
  let aiImportant = 0;
  for (const m of rows) {
    if (m.deleted || m.isDraft || m.resolved) continue;
    if (m.jobId && m.direction === "inbound") assignedToJobs++;
    if (m.aiReviewPending) aiImportant++;
  }

  return NextResponse.json({
    ok: true,
    mailboxId: loaded.mailbox.mailboxId,
    mailboxEmail: loaded.mailbox.emailAddress,
    waitingReply: dash.waitingReply,
    overdue: dash.overdue,
    assignedToMe: dash.assignedToMe,
    urgent: dash.urgent,
    assignedToJobs,
    aiImportant,
  });
}
