"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { useUser, useFirestore, useMemoFirebase, useCollection, useCompany } from "@/firebase";
import { applyAppBadgeCount } from "@/lib/app-badge";
import { isGlobalAdminAppPath } from "@/lib/global-admin-shell";

type ChatRow = {
  senderRole?: string;
  read?: boolean;
};

/**
 * Nepřečtené zprávy od zaměstnanců (stejná logika jako na dashboardu).
 * Na `/admin/*` se neodbavuje Firestore dotaz — globální administrace nesmí záviset na tenant datech.
 */
export function useUnreadEmployeeChatCount() {
  const pathname = usePathname() ?? "";
  const skipForGlobalAdminShell = isGlobalAdminAppPath(pathname);
  const { user } = useUser();
  const firestore = useFirestore();
  const { companyId, userProfile, isLoading: companyCtxLoading } = useCompany();

  const role = (userProfile as { role?: string } | null)?.role ?? "employee";
  const showAdminMessaging = ["owner", "admin", "manager", "accountant"].includes(role);

  const chatQuery = useMemoFirebase(() => {
    if (skipForGlobalAdminShell || !firestore || !companyId || !showAdminMessaging) {
      return null;
    }
    return query(
      collection(firestore, "companies", companyId, "chat"),
      orderBy("createdAt", "desc"),
      limit(500)
    );
  }, [skipForGlobalAdminShell, firestore, companyId, showAdminMessaging]);

  const { data: chatRows = [], isLoading } = useCollection(chatQuery);

  const count = useMemo(() => {
    const rows = Array.isArray(chatRows) ? chatRows : [];
    return rows.filter(
      (m: ChatRow) => m.senderRole === "employee" && m.read !== true
    ).length;
  }, [chatRows]);

  useEffect(() => {
    if (
      skipForGlobalAdminShell ||
      !showAdminMessaging ||
      !companyId ||
      companyCtxLoading
    ) {
      return;
    }
    console.log("Unread employee messages count", { count, companyId });
  }, [
    skipForGlobalAdminShell,
    count,
    companyId,
    companyCtxLoading,
    showAdminMessaging,
  ]);

  useEffect(() => {
    if (skipForGlobalAdminShell || !user || !showAdminMessaging) return;
    applyAppBadgeCount(count);
  }, [skipForGlobalAdminShell, count, user, showAdminMessaging]);

  return {
    count: skipForGlobalAdminShell ? 0 : count,
    isLoading: skipForGlobalAdminShell
      ? false
      : companyCtxLoading || (showAdminMessaging && isLoading),
    showBadge: skipForGlobalAdminShell ? false : showAdminMessaging,
  };
}
