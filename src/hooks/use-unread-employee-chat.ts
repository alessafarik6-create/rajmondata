"use client";

import { useEffect, useMemo } from "react";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { useUser, useFirestore, useMemoFirebase, useCollection, useCompany } from "@/firebase";
import { applyAppBadgeCount } from "@/lib/app-badge";

type ChatRow = {
  senderRole?: string;
  read?: boolean;
};

/**
 * Nepřečtené zprávy od zaměstnanců (stejná logika jako na dashboardu).
 */
export function useUnreadEmployeeChatCount() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { companyId, userProfile, isLoading: companyCtxLoading } = useCompany();

  const role = (userProfile as { role?: string } | null)?.role ?? "employee";
  const showAdminMessaging = ["owner", "admin", "manager", "accountant"].includes(role);

  const chatQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminMessaging) return null;
    return query(
      collection(firestore, "companies", companyId, "chat"),
      orderBy("createdAt", "desc"),
      limit(500)
    );
  }, [firestore, companyId, showAdminMessaging]);

  const { data: chatRows = [], isLoading } = useCollection(chatQuery);

  const count = useMemo(() => {
    const rows = Array.isArray(chatRows) ? chatRows : [];
    return rows.filter(
      (m: ChatRow) => m.senderRole === "employee" && m.read !== true
    ).length;
  }, [chatRows]);

  useEffect(() => {
    if (!showAdminMessaging || !companyId || companyCtxLoading) return;
    console.log("Unread employee messages count", { count, companyId });
  }, [count, companyId, companyCtxLoading, showAdminMessaging]);

  useEffect(() => {
    if (!user || !showAdminMessaging) return;
    applyAppBadgeCount(count);
  }, [count, user, showAdminMessaging]);

  return {
    count,
    isLoading: companyCtxLoading || (showAdminMessaging && isLoading),
    showBadge: showAdminMessaging,
  };
}
