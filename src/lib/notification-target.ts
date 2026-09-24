import type { NotificationEventType, NotificationEntityType } from "@/lib/notification-service/types";

/** Zdroj pro resolve — inbox doc, create input nebo UI item. */
export type NotificationTargetSource = {
  id?: string;
  type?: string | null;
  category?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  linkUrl?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetUrl?: string | null;
  jobId?: string | null;
  messageId?: string | null;
  commentId?: string | null;
  conversationId?: string | null;
  documentId?: string | null;
  invoiceId?: string | null;
  inquiryId?: string | null;
  calendarEventId?: string | null;
  eventId?: string | null;
};

export type ResolvedNotificationTarget = {
  href: string;
  targetType: string;
  targetId: string | null;
  missing: boolean;
};

const GENERIC_FALLBACKS = new Set([
  "/portal/dashboard",
  "/portal/notifications",
  "/portal/employee",
]);

function trim(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

/** Cesta k detailu zakázky + komunikace. */
export function buildJobCommunicationPath(
  role: string | undefined,
  jobId: string,
  opts?: {
    commentId?: string | null;
    fileId?: string | null;
    communication?: boolean;
  }
): string {
  const jid = trim(jobId);
  if (!jid) return role === "employee" ? "/portal/employee/jobs" : "/portal/jobs";
  const base = buildJobDetailPath(role, jid);
  const params = new URLSearchParams();
  const cid = trim(opts?.commentId);
  const fid = trim(opts?.fileId);
  const openComm = opts?.communication === true || Boolean(cid || fid);
  if (openComm) params.set("section", "communication");
  if (cid) params.set("commentId", cid);
  if (fid) params.set("fileId", fid);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

export function buildJobDetailPath(role: string | undefined, jobId: string): string {
  const jid = trim(jobId);
  if (!jid) return role === "employee" ? "/portal/employee/jobs" : "/portal/jobs";
  if (role === "employee") return `/portal/employee/jobs/${enc(jid)}`;
  if (role === "customer") return `/portal/customer/jobs/${enc(jid)}`;
  return `/portal/jobs/${enc(jid)}`;
}

function normalizePath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.split("#")[0] || p;
}

function isGenericFallback(path: string): boolean {
  const p = normalizePath(path);
  if (GENERIC_FALLBACKS.has(p)) return true;
  if (p === "/portal/dashboard" || p === "/portal/notifications") return true;
  return false;
}

function hrefFromExplicit(url: string | null | undefined): string | null {
  const u = trim(url);
  if (!u) return null;
  if (u.startsWith("http://") || u.startsWith("https://")) {
    try {
      const parsed = new URL(u);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/portal/notifications";
    } catch {
      return null;
    }
  }
  return normalizePath(u);
}

export function resolveNotificationTarget(
  source: NotificationTargetSource,
  opts?: { role?: string }
): ResolvedNotificationTarget {
  const role = trim(opts?.role);
  const type = trim(source.type) as NotificationEventType | "";
  const entityType = trim(source.entityType) as NotificationEntityType | "";
  const entityId = trim(source.entityId);
  const jobId = trim(source.jobId) || (entityType === "job" ? entityId : "");
  const commentId = trim(source.commentId) || trim(source.messageId);
  const conversationId = trim(source.conversationId);
  const documentId = trim(source.documentId);
  const invoiceId = trim(source.invoiceId);
  const inquiryId = trim(source.inquiryId);
  const calendarEventId =
    trim(source.calendarEventId) ||
    (entityType === "meeting" ? entityId : "") ||
    trim(source.eventId);

  const explicit =
    hrefFromExplicit(source.targetUrl) ||
    hrefFromExplicit(source.linkUrl);

  if (explicit && !isGenericFallback(explicit)) {
    return {
      href: explicit,
      targetType: trim(source.targetType) || "link",
      targetId: trim(source.targetId) || entityId || null,
      missing: false,
    };
  }

  if (
    type === "JOB_CUSTOMER_MESSAGE" ||
    type === "JOB_UPDATED" ||
    type === "JOB_ASSIGNED" ||
    type === "DOCUMENT_APPROVED" ||
    (entityType === "job" && jobId)
  ) {
    if (jobId) {
      const openComm =
        type === "JOB_CUSTOMER_MESSAGE" || Boolean(commentId);
      const href = openComm
        ? buildJobCommunicationPath(role, jobId, {
            commentId: commentId || undefined,
            communication: true,
          })
        : buildJobDetailPath(role, jobId);
      return {
        href,
        targetType: commentId ? "job-message" : "job",
        targetId: commentId || jobId,
        missing: false,
      };
    }
  }

  if (type === "INQUIRY_CREATED" || entityType === "inquiry") {
    if (inquiryId) {
      return {
        href: `/portal/leads?openLead=${enc(inquiryId)}`,
        targetType: "inquiry",
        targetId: inquiryId,
        missing: false,
      };
    }
    return {
      href: "/portal/leads?filter=new",
      targetType: "inquiry",
      targetId: null,
      missing: false,
    };
  }

  if (type === "INVOICE_OVERDUE" || entityType === "invoice") {
    const iid = invoiceId || entityId;
    if (iid) {
      return {
        href: `/portal/invoices/${enc(iid)}`,
        targetType: "invoice",
        targetId: iid,
        missing: false,
      };
    }
  }

  if (entityType === "document" || documentId) {
    const did = documentId || entityId;
    if (did) {
      return {
        href: `/portal/documents?highlight=${enc(did)}`,
        targetType: "document",
        targetId: did,
        missing: false,
      };
    }
  }

  if (
    type === "EMAIL_RECEIVED" ||
    type === "EMAIL_ASSIGNED" ||
    type === "EMAIL_OVERDUE" ||
    entityType === "email"
  ) {
    const mid = trim(source.messageId) || entityId;
    if (mid) {
      return {
        href: `/portal/email?messageId=${enc(mid)}`,
        targetType: "email",
        targetId: mid,
        missing: false,
      };
    }
  }

  if (type === "CHAT_MESSAGE" || type === "CHAT_ADMIN_MESSAGE") {
    const conv = conversationId || entityId || "company";
    const chatBase = role === "employee" ? "/portal/employee/messages" : "/portal/chat";
    const params = new URLSearchParams();
    params.set("c", conv);
    const mid = trim(source.messageId);
    if (mid) params.set("messageId", mid);
    return {
      href: `${chatBase}?${params.toString()}`,
      targetType: "chat",
      targetId: conv,
      missing: false,
    };
  }

  if (type === "MEETING_REMINDER" || entityType === "meeting") {
    if (calendarEventId) {
      return {
        href: `/portal/schedule?event=${enc(calendarEventId)}`,
        targetType: "calendar-event",
        targetId: calendarEventId,
        missing: false,
      };
    }
  }

  if (type === "TASK_ASSIGNED" || type === "TASK_DUE" || entityType === "task") {
    if (entityId) {
      return {
        href: `/portal/tasks?highlight=${enc(entityId)}`,
        targetType: "task",
        targetId: entityId,
        missing: false,
      };
    }
  }

  if (explicit) {
    return {
      href: explicit,
      targetType: trim(source.targetType) || "link",
      targetId: trim(source.targetId) || null,
      missing: isGenericFallback(explicit),
    };
  }

  if (source.id && (type === "SYSTEM_ALERT" || trim(source.category) === "system")) {
    return {
      href: `/portal/notifications?focus=${enc(source.id)}`,
      targetType: "announcement",
      targetId: source.id,
      missing: false,
    };
  }

  return {
    href: "/portal/notifications",
    targetType: "unknown",
    targetId: null,
    missing: true,
  };
}

export function logNotificationOpen(
  source: NotificationTargetSource,
  resolved: ResolvedNotificationTarget
): void {
  if (process.env.NODE_ENV !== "development") return;
  console.log("[NOTIFICATION OPEN]", {
    notificationId: source.id ?? "—",
    type: source.type ?? "—",
    targetType: resolved.targetType,
    targetId: resolved.targetId,
    targetUrl: resolved.href,
  });
  if (resolved.missing) {
    console.log("[NOTIFICATION TARGET MISSING]", source);
  }
}

export type CreateNotificationTargetFields = {
  url: string;
  targetType: string;
  targetId: string | null;
  targetUrl: string;
  jobId?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
};

/** Pro server — sestaví URL + metadata před zápisem do inboxu. */
export function resolveCreateNotificationTarget(input: {
  type: NotificationEventType;
  url?: string | null;
  entityType?: NotificationEntityType;
  entityId?: string | null;
  jobId?: string | null;
  messageId?: string | null;
  commentId?: string | null;
  conversationId?: string | null;
  documentId?: string | null;
  invoiceId?: string | null;
  inquiryId?: string | null;
  calendarEventId?: string | null;
  targetType?: string | null;
}): CreateNotificationTargetFields {
  const resolved = resolveNotificationTarget(
    {
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      linkUrl: input.url,
      jobId: input.jobId,
      messageId: input.messageId,
      commentId: input.commentId,
      conversationId: input.conversationId,
      documentId: input.documentId,
      invoiceId: input.invoiceId,
      inquiryId: input.inquiryId,
      calendarEventId: input.calendarEventId,
      targetType: input.targetType,
    },
    { role: "owner" }
  );
  const href = input.url?.trim() && !isGenericFallback(input.url.trim())
    ? normalizePath(input.url.trim())
    : resolved.href;
  return {
    url: href,
    targetType: input.targetType?.trim() || resolved.targetType,
    targetId: resolved.targetId,
    targetUrl: href,
    jobId: input.jobId ?? (input.entityType === "job" ? input.entityId : null),
    messageId: input.messageId ?? input.commentId ?? null,
    conversationId: input.conversationId ?? null,
  };
}
