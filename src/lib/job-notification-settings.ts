/**
 * Přepínače e-mailových notifikací u složek zakázky a chatů.
 */

export {
  parseFolderEmailNotificationSettings,
  parseJobInternalChatNotificationSettings,
  parseJobCustomerChatNotificationSettings,
} from "@/lib/job-notification-recipients";

/** @deprecated Použijte parseFolderEmailNotificationSettings */
export function isFolderNotifyEmployeesEnabled(
  folder: Record<string, unknown> | null | undefined
): boolean {
  const enabled = folder?.emailNotificationsEnabled === true;
  const legacy = folder?.notifyEmployees === true;
  const recipients = Array.isArray(folder?.notificationRecipients)
    ? (folder!.notificationRecipients as unknown[])
    : [];
  if (enabled) {
    return recipients.some(
      (r) =>
        r &&
        typeof r === "object" &&
        (r as { type?: string; enabled?: boolean }).type === "employee" &&
        (r as { enabled?: boolean }).enabled !== false
    );
  }
  return legacy;
}

/** @deprecated Použijte parseFolderEmailNotificationSettings */
export function isFolderNotifyCustomerEnabled(
  folder: Record<string, unknown> | null | undefined
): boolean {
  const enabled = folder?.emailNotificationsEnabled === true;
  const legacy = folder?.notifyCustomer === true;
  const recipients = Array.isArray(folder?.notificationRecipients)
    ? (folder!.notificationRecipients as unknown[])
    : [];
  if (enabled) {
    return recipients.some(
      (r) =>
        r &&
        typeof r === "object" &&
        (r as { type?: string; enabled?: boolean }).type === "customer" &&
        (r as { enabled?: boolean }).enabled !== false
    );
  }
  return legacy;
}

export function isJobInternalChatEmailEnabled(
  job: Record<string, unknown> | null | undefined
): boolean {
  if (!job) return false;
  if (job.internalChatEmailNotificationsEnabled !== undefined) {
    return job.internalChatEmailNotificationsEnabled === true;
  }
  return job.internalChatEmailNotifications === true;
}

export function isJobCustomerChatEmailEnabled(
  job: Record<string, unknown> | null | undefined
): boolean {
  if (!job) return false;
  if (job.customerChatEmailNotificationsEnabled !== undefined) {
    return job.customerChatEmailNotificationsEnabled === true;
  }
  return job.customerChatEmailNotifications === true;
}
