import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  logNotificationOpen,
  resolveNotificationTarget,
  type NotificationTargetSource,
} from "@/lib/notification-target";
import type { PortalNotificationItem } from "@/components/portal/portal-notifications-context";

export function portalNotificationToTargetSource(
  item: PortalNotificationItem
): NotificationTargetSource {
  return {
    id: item.id,
    type: item.type,
    category: item.category,
    entityType: item.entityType,
    entityId: item.entityId,
    linkUrl: item.linkUrl,
    targetType: item.targetType,
    targetId: item.targetId,
    targetUrl: item.targetUrl,
    jobId: item.jobId,
    messageId: item.messageId,
    commentId: item.commentId ?? item.messageId,
    conversationId: item.conversationId,
    documentId: item.documentId,
    invoiceId: item.invoiceId,
    inquiryId: item.inquiryId,
    calendarEventId: item.calendarEventId,
  };
}

export async function openPortalNotification(
  item: PortalNotificationItem,
  opts: {
    role?: string;
    markAsRead: (id: string) => Promise<void>;
    router: AppRouterInstance;
  }
): Promise<void> {
  const source = portalNotificationToTargetSource(item);
  const resolved = resolveNotificationTarget(source, { role: opts.role });
  logNotificationOpen(source, resolved);
  if (!item.read) {
    try {
      await opts.markAsRead(item.id);
    } catch {
      /* navigace i při chybě zápisu */
    }
  }
  opts.router.push(resolved.href);
}
