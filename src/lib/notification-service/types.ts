import type { PortalNotificationCategory } from "@/lib/portal-notifications-types";

export type NotificationEventType =
  | "JOB_ASSIGNED"
  | "JOB_UPDATED"
  | "JOB_CUSTOMER_MESSAGE"
  | "DOCUMENT_APPROVED"
  | "EMAIL_RECEIVED"
  | "EMAIL_ASSIGNED"
  | "EMAIL_OVERDUE"
  | "INQUIRY_CREATED"
  | "INVOICE_OVERDUE"
  | "TASK_ASSIGNED"
  | "TASK_DUE"
  | "MEETING_REMINDER"
  | "ATTENDANCE_REMINDER"
  | "CHAT_MESSAGE"
  | "CHAT_ADMIN_MESSAGE"
  | "SYSTEM_ALERT";

export type NotificationPriority = "NORMAL" | "HIGH" | "URGENT";

export type NotificationEntityType =
  | "job"
  | "email"
  | "inquiry"
  | "invoice"
  | "document"
  | "task"
  | "meeting"
  | "attendance"
  | "system";

export type NotificationPreferenceGroups = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  jobs: boolean;
  emails: boolean;
  inquiries: boolean;
  documents: boolean;
  tasks: boolean;
  meetings: boolean;
  attendance: boolean;
  messages: boolean;
  adminMessages: boolean;
  urgent: boolean;
  /** Budoucí tiché hodiny — zatím neplánované odesílání */
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceGroups = {
  pushEnabled: true,
  emailEnabled: true,
  jobs: true,
  emails: true,
  inquiries: true,
  documents: true,
  tasks: true,
  meetings: true,
  attendance: true,
  messages: true,
  adminMessages: true,
  urgent: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "06:00",
};

export type CreateNotificationInput = {
  organizationId: string;
  recipientUserId: string;
  type: NotificationEventType;
  title: string;
  body: string;
  url?: string | null;
  entityType?: NotificationEntityType;
  entityId?: string | null;
  priority?: NotificationPriority;
  /** Unikátní klíč pro deduplikaci (stejný event nesmí dorazit 2×). */
  eventId?: string | null;
  /** Mapování na starší kategorii inboxu. */
  category?: PortalNotificationCategory;
  source?: string | null;
  /** Vynutit push i mimo preference (urgent systém). */
  forcePush?: boolean;
  /** Pouze in-app záznam bez Web Push. */
  skipPush?: boolean;
  targetType?: string | null;
  jobId?: string | null;
  messageId?: string | null;
  commentId?: string | null;
  conversationId?: string | null;
  documentId?: string | null;
  invoiceId?: string | null;
  inquiryId?: string | null;
  calendarEventId?: string | null;
};
