import type { EmailMessageDoc } from "@/lib/email-mailbox/types";
import {
  normalizeAiCategory,
  type EmailAiCategory,
  type EmailMessageWorkflowView,
} from "@/lib/email-mailbox/intelligence-types";

function isActive(m: EmailMessageDoc): boolean {
  return !m.deleted && !m.isDraft && !m.resolved;
}

function categoryOf(m: EmailMessageDoc): EmailAiCategory {
  const c = m.aiCategory ?? normalizeAiCategory(m.aiClassification);
  return normalizeAiCategory(c);
}

function isSpam(m: EmailMessageDoc): boolean {
  const c = categoryOf(m);
  return (
    String(m.aiClassification ?? "").toLowerCase() === "spam" ||
    String(m.folder ?? "").toLowerCase() === "spam"
  );
}

export function buildMessageViewFilter(
  view: EmailMessageWorkflowView,
  callerUid?: string
): (m: EmailMessageDoc) => boolean {
  switch (view) {
    case "waiting_reply":
      return (m) =>
        isActive(m) &&
        m.direction === "inbound" &&
        Boolean(m.needsReply || m.workflowState === "waiting_reply");
    case "needs_action":
      return (m) =>
        isActive(m) &&
        m.direction === "inbound" &&
        (Boolean(m.requiresAction) || m.workflowState === "pending_action");
    case "assigned_to_me":
      return (m) =>
        isActive(m) &&
        Boolean(callerUid && m.assignedToUserId === callerUid);
    case "delegated":
      return (m) =>
        isActive(m) &&
        Boolean(
          callerUid &&
            m.assignedByUserId === callerUid &&
            m.assignedToUserId &&
            m.assignedToUserId !== callerUid
        );
    case "ai_suggestions":
    case "ai_review":
      return (m) =>
        isActive(m) &&
        (Boolean(m.aiReviewPending) ||
          Boolean(m.inquiryDraft) ||
          (m.suggestedActions?.length ?? 0) > 0);
    case "cat_jobs":
      return (m) => isActive(m) && categoryOf(m) === "JOB";
    case "cat_inquiries":
      return (m) => isActive(m) && categoryOf(m) === "INQUIRY";
    case "cat_invoices_docs":
      return (m) =>
        isActive(m) && (categoryOf(m) === "INVOICE" || categoryOf(m) === "DOCUMENT");
    case "cat_orders":
      return (m) => isActive(m) && categoryOf(m) === "ORDER";
    case "cat_complaints":
      return (m) => isActive(m) && categoryOf(m) === "COMPLAINT";
    case "cat_suppliers":
      return (m) => isActive(m) && categoryOf(m) === "SUPPLIER";
    case "assigned":
      return (m) =>
        isActive(m) && Boolean(m.customerId || m.jobId || m.inquiryId || m.assignedToUserId);
    case "unassigned":
      return (m) =>
        isActive(m) &&
        m.direction === "inbound" &&
        !m.customerId &&
        !m.jobId &&
        !m.inquiryId &&
        !m.assignedToUserId;
    case "resolved":
      return (m) => Boolean(m.resolved);
    case "sent":
      return (m) => m.direction === "outbound" && !m.isDraft && !m.deleted;
    case "drafts":
      return (m) => Boolean(m.isDraft) && !m.deleted;
    case "archive":
      return (m) => Boolean(m.resolved) && !m.deleted;
    case "spam":
      return (m) => isSpam(m) && !m.deleted;
    case "trash":
      return (m) => Boolean(m.deleted);
    case "inbox":
    default:
      return (m) =>
        m.direction === "inbound" &&
        !m.deleted &&
        !m.isDraft &&
        !m.resolved &&
        !isSpam(m);
  }
}

export function messageIsStaleNeedsReply(m: EmailMessageDoc): boolean {
  if (!m.needsReply || m.resolved || m.repliedAt) return false;
  const ts = m.receivedAt?.toMillis?.() ?? 0;
  if (!ts) return false;
  return Date.now() - ts > 48 * 60 * 60 * 1000;
}

export function messageIsOverdueAssignment(m: EmailMessageDoc): boolean {
  if (m.resolved || !m.assignmentDueAt) return false;
  const due = m.assignmentDueAt.toMillis?.() ?? 0;
  return due > 0 && due < Date.now();
}

export type EmailFolderCounts = Record<string, number>;

export function computeFolderCounts(
  rows: EmailMessageDoc[],
  callerUid: string
): EmailFolderCounts {
  const counts: EmailFolderCounts = {};
  for (const def of [
    "inbox",
    "waiting_reply",
    "needs_action",
    "assigned_to_me",
    "delegated",
    "ai_suggestions",
    "cat_jobs",
    "cat_inquiries",
    "cat_invoices_docs",
    "cat_orders",
    "cat_complaints",
    "cat_suppliers",
    "drafts",
  ] as EmailMessageWorkflowView[]) {
    const fn = buildMessageViewFilter(def, callerUid);
    counts[def] = rows.filter(fn).length;
  }
  return counts;
}

export function computeDashboardEmailStats(rows: EmailMessageDoc[], callerUid: string) {
  let waitingReply = 0;
  let overdue = 0;
  let assignedToMe = 0;
  let urgent = 0;

  for (const m of rows) {
    if (m.deleted || m.isDraft || m.resolved) continue;
    if (buildMessageViewFilter("waiting_reply")(m)) waitingReply++;
    if (messageIsOverdueAssignment(m)) overdue++;
    if (buildMessageViewFilter("assigned_to_me", callerUid)(m)) assignedToMe++;
    const p = String(m.aiPriority ?? "").toUpperCase();
    if (p === "URGENT" || p === "HIGH") urgent++;
    if (messageIsStaleNeedsReply(m)) overdue++;
  }

  return { waitingReply, overdue, assignedToMe, urgent };
}
