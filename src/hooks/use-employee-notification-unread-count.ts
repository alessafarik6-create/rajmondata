"use client";

import { useMemo } from "react";
import { collection, limit, query, where } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";

/**
 * Lehký dotaz bez orderBy (stačí automatický jednopolový index) — jen pro badge počtu nepřečtených.
 */
export function useEmployeeNotificationUnreadCount(params: {
  companyId: string | undefined;
  employeeId: string | undefined;
}) {
  const { companyId, employeeId } = params;
  const firestore = useFirestore();

  const qRef = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_notifications"),
      where("employeeId", "==", employeeId),
      limit(100)
    );
  }, [firestore, companyId, employeeId]);

  const { data: raw = [], isLoading } = useCollection(qRef, {
    suppressGlobalPermissionError: true,
  });

  const unreadCount = useMemo(() => {
    const list = Array.isArray(raw) ? raw : [];
    return list.filter((d: { isRead?: boolean }) => d?.isRead !== true).length;
  }, [raw]);

  return { unreadCount, isLoading };
}
