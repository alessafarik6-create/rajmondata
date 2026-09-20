import { NextRequest } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailJsonErr, emailJsonOk, emailRouteErrorResponse } from "@/lib/email-mailbox/api-json";
import {
  loadAccessibleAccountIdSet,
  listEmailAccountsAccessibleToUser,
  messageBelongsToUser,
} from "@/lib/email-mailbox/account-access";
import { EMAIL_ACCOUNT_ALL_MAILBOXES } from "@/lib/email-mailbox/account-default";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import {
  buildMessageViewFilter,
  messageIsStaleNeedsReply,
} from "@/lib/email-mailbox/message-store";
import { attachmentCountForList } from "@/lib/email-mailbox/attachment-meta";
import type { EmailMessageDoc, EmailMessageWorkflowView } from "@/lib/email-mailbox/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const perm = await requireEmailMailboxRead(request);
    if (!perm.ok) {
      return emailJsonErr({
        status: perm.status,
        message: perm.error,
        error: perm.error,
      });
    }

    const companyId =
      String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
    if (!emailMailboxTenantOk(perm.caller, companyId)) {
      return emailJsonErr({ status: 403, message: "Neplatná organizace.", errorCode: "TENANT_MISMATCH" });
    }
    const view = (request.nextUrl.searchParams.get("view") ??
      "inbox") as EmailMessageWorkflowView;
    const accountIdParam = request.nextUrl.searchParams.get("accountId");
    const allMailboxes =
      !accountIdParam ||
      accountIdParam === EMAIL_ACCOUNT_ALL_MAILBOXES ||
      accountIdParam === "all";

    const accessibleIds = await loadAccessibleAccountIdSet(perm.db, companyId, perm.caller.uid);
    if (accessibleIds.size === 0) {
      return emailJsonOk({ view, messages: [] });
    }

    const accountRows = await listEmailAccountsAccessibleToUser(
      perm.db,
      companyId,
      perm.caller.uid,
      "read"
    );
    const emailByAccountId = new Map(accountRows.map((a) => [a.id, a.email]));

    if (!allMailboxes && accountIdParam && !accessibleIds.has(accountIdParam)) {
      return emailJsonErr({
        status: 403,
        message: "Nemáte přístup k této schránce.",
        errorCode: "MAILBOX_FORBIDDEN",
      });
    }

    let snap;
    try {
      snap = await emailMessagesCol(perm.db, companyId)
        .orderBy("receivedAt", "desc")
        .limit(120)
        .get();
    } catch {
      snap = await emailMessagesCol(perm.db, companyId).limit(200).get();
    }
    const filterFn = buildMessageViewFilter(view, perm.caller.uid);
    const messages = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }))
      .filter((m) => messageBelongsToUser(m, perm.caller.uid, accessibleIds))
      .filter((m) =>
        allMailboxes || !accountIdParam ? true : m.emailAccountId === accountIdParam
      )
      .filter(filterFn)
      .sort((a, b) => (b.receivedAt?.toMillis?.() ?? 0) - (a.receivedAt?.toMillis?.() ?? 0))
      .slice(0, 120)
      .map((m) => ({
        id: m.id,
        emailAccountId: m.emailAccountId,
        mailboxEmail: emailByAccountId.get(m.emailAccountId) ?? null,
        from: m.from,
        subject: m.subject,
        receivedAt: m.receivedAt?.toDate?.()?.toISOString?.() ?? null,
        needsReply: m.needsReply,
        staleNeedsReply: messageIsStaleNeedsReply(m),
        aiSummary: m.aiSummary ?? null,
        aiClassification: m.aiClassification ?? null,
        aiPriority: m.aiPriority ?? null,
        aiCategory: m.aiCategory ?? null,
        workflowState: m.workflowState ?? null,
        requiresAction: Boolean(m.requiresAction),
        assignedToUserId: m.assignedToUserId ?? null,
        customerId: m.customerId ?? null,
        jobId: m.jobId ?? null,
        inquiryId: m.inquiryId ?? null,
        resolved: Boolean(m.resolved),
        aiReviewPending: Boolean(m.aiReviewPending),
        direction: m.direction,
        isRead: Boolean(m.isRead),
        customerName: m.customerName ?? null,
        jobLabel: m.jobLabel ?? null,
        attachmentCount: attachmentCountForList(m.attachments),
      }));

    return emailJsonOk({ view, messages });
  } catch (err) {
    console.error("[email-mailbox/messages GET]", err instanceof Error ? err.message : err);
    return emailRouteErrorResponse(err, "Nepodařilo se načíst zprávy.");
  }
}
