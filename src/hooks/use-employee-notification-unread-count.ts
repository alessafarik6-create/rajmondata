"use client";

import { useEmployeeNotificationsInbox } from "@/hooks/use-employee-notifications-inbox";

/** Počítadlo nepřečtených — stejný Firestore dotaz jako `EmployeeNotificationsPanel` (sdílená logika v `useEmployeeNotificationsInbox`). */
export function useEmployeeNotificationUnreadCount(params: {
  companyId: string | undefined;
  employeeId: string | undefined;
}) {
  const { unreadCount, isLoading } = useEmployeeNotificationsInbox(params);
  return { unreadCount, isLoading };
}
