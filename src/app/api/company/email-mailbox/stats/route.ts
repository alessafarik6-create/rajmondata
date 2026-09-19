import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import {
  loadAccessibleAccountIdSet,
  messageBelongsToUser,
} from "@/lib/email-mailbox/account-access";
import { emailMessagesCol, messageIsStaleNeedsReply } from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";
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

  const accessibleIds = await loadAccessibleAccountIdSet(perm.db, companyId, perm.caller.uid);
  if (accessibleIds.size === 0) {
    return NextResponse.json({
      ok: true,
      waitingReply: 0,
      assignedToJobs: 0,
      aiImportant: 0,
    });
  }

  const snap = await emailMessagesCol(perm.db, companyId).orderBy("receivedAt", "desc").limit(150).get();
  const rows = snap.docs
    .map((d) => d.data() as EmailMessageDoc)
    .filter((m) => messageBelongsToUser(m, perm.caller.uid, accessibleIds));

  let waitingReply = 0;
  let assignedToJobs = 0;
  let aiImportant = 0;

  for (const m of rows) {
    if (m.deleted || m.isDraft) continue;
    if (m.needsReply && !m.resolved && m.direction === "inbound") waitingReply++;
    if (m.jobId && m.direction === "inbound" && !m.resolved) assignedToJobs++;
    if (messageIsStaleNeedsReply(m)) aiImportant++;
    if ((m.aiInsights?.length ?? 0) > 0 && m.aiReviewPending) aiImportant++;
  }

  return NextResponse.json({
    ok: true,
    waitingReply,
    assignedToJobs,
    aiImportant,
  });
}
