import type {
  CreateNotificationInput,
  NotificationEventType,
  NotificationPreferenceGroups,
  NotificationPriority,
} from "@/lib/notification-service/types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notification-service/types";

export function mergeNotificationPreferences(
  raw: Record<string, unknown> | null | undefined
): NotificationPreferenceGroups {
  const d = DEFAULT_NOTIFICATION_PREFERENCES;
  if (!raw || typeof raw !== "object") return { ...d };
  /** Klíče chybějící v DB = uživatel je nikdy neukládal → povolit (zpětná kompatibilita po 5eb6bcb). */
  const b = (k: keyof NotificationPreferenceGroups, fallback: boolean) => {
    if (!(k in raw)) return fallback;
    return typeof raw[k] === "boolean" ? (raw[k] as boolean) : fallback;
  };
  const s = (k: "quietHoursStart" | "quietHoursEnd", fallback: string) =>
    typeof raw[k] === "string" && raw[k].trim() ? String(raw[k]).trim() : fallback;
  return {
    pushEnabled: b("pushEnabled", d.pushEnabled),
    emailEnabled: b("emailEnabled", d.emailEnabled),
    jobs: b("jobs", d.jobs),
    emails: b("emails", d.emails),
    inquiries: b("inquiries", d.inquiries),
    documents: b("documents", d.documents),
    tasks: b("tasks", d.tasks),
    meetings: b("meetings", d.meetings),
    attendance: b("attendance", d.attendance),
    messages: b("messages", d.messages),
    adminMessages: b("adminMessages", d.adminMessages),
    urgent: b("urgent", d.urgent),
    quietHoursEnabled: b("quietHoursEnabled", d.quietHoursEnabled),
    quietHoursStart: s("quietHoursStart", d.quietHoursStart),
    quietHoursEnd: s("quietHoursEnd", d.quietHoursEnd),
  };
}

function preferenceGroupForEvent(type: NotificationEventType): keyof NotificationPreferenceGroups | null {
  switch (type) {
    case "JOB_ASSIGNED":
    case "JOB_UPDATED":
    case "JOB_CUSTOMER_MESSAGE":
      return "jobs";
    case "EMAIL_RECEIVED":
    case "EMAIL_ASSIGNED":
    case "EMAIL_OVERDUE":
      return "emails";
    case "INQUIRY_CREATED":
      return "inquiries";
    case "INVOICE_OVERDUE":
    case "DOCUMENT_APPROVED":
      return "documents";
    case "TASK_ASSIGNED":
    case "TASK_DUE":
      return "tasks";
    case "MEETING_REMINDER":
      return "meetings";
    case "ATTENDANCE_REMINDER":
      return "attendance";
    case "CHAT_MESSAGE":
      return "messages";
    case "CHAT_ADMIN_MESSAGE":
      return "adminMessages";
    case "SYSTEM_ALERT":
      return null;
    default:
      return null;
  }
}

function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** V budoucnu — urgent projde vždy. */
export function isWithinQuietHours(
  prefs: NotificationPreferenceGroups,
  priority: NotificationPriority,
  now = new Date()
): boolean {
  if (!prefs.quietHoursEnabled || priority === "URGENT") return false;
  const start = parseHm(prefs.quietHoursStart);
  const end = parseHm(prefs.quietHoursEnd);
  if (start == null || end == null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

export function shouldSendPushForNotification(
  prefs: NotificationPreferenceGroups,
  input: CreateNotificationInput
): boolean {
  if (input.forcePush) return true;
  if (!prefs.pushEnabled) return false;
  const priority = input.priority ?? "NORMAL";
  if (priority === "URGENT" && !prefs.urgent) return false;
  const group = preferenceGroupForEvent(input.type);
  if (group && !prefs[group]) {
    return false;
  }
  if (isWithinQuietHours(prefs, priority)) return false;
  return true;
}
