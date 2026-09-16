export type PlatformAdminNotificationType = "NEW_ORGANIZATION_REGISTERED";

export type PlatformAdminNotificationDoc = {
  type: PlatformAdminNotificationType;
  title: string;
  message: string;
  organizationId: string;
  createdAt: FirebaseFirestore.Timestamp | null;
  readAt: FirebaseFirestore.Timestamp | null;
  metadata: Record<string, unknown> | null;
  emailSentAt?: FirebaseFirestore.Timestamp | null;
  emailError?: string | null;
};
