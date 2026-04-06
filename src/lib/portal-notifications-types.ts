/**
 * Portálová oznámení — inbox pod uživatelem + Web Push subscription.
 * Firestore: users/{uid}/notificationInbox/{id}, users/{uid}/pushSubscriptions/{id}
 */

export type PortalNotificationCategory =
  | "profile"
  | "message"
  | "media"
  | "job"
  | "document"
  | "activity"
  | "system";

export type PortalNotificationInboxDoc = {
  companyId?: string | null;
  category: PortalNotificationCategory;
  title: string;
  body: string;
  linkUrl?: string | null;
  read: boolean;
  createdAt: unknown;
  /** Volitelně k filtrování / analytice */
  source?: string | null;
};
