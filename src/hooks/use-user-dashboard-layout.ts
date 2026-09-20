"use client";

import { useCallback, useMemo } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import {
  dashboardLayoutDocId,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  normalizeDashboardWidgetOrder,
  type DashboardWidgetId,
} from "@/lib/dashboard-widget-layout";

type LayoutDoc = {
  userId?: string;
  organizationId?: string;
  items?: string[];
  updatedAt?: unknown;
};

export function useUserDashboardLayout(companyId: string) {
  const firestore = useFirestore();
  const { user } = useUser();

  const layoutRef = useMemoFirebase(() => {
    if (!firestore || !user?.uid || !companyId) return null;
    return doc(
      firestore,
      "companies",
      companyId,
      "userDashboardLayouts",
      dashboardLayoutDocId(user.uid, companyId)
    );
  }, [firestore, user?.uid, companyId]);

  const { data: layoutRaw, isLoading } = useDoc<LayoutDoc>(layoutRef);

  const order = useMemo(
    () => normalizeDashboardWidgetOrder(layoutRaw?.items),
    [layoutRaw?.items]
  );

  const saveOrder = useCallback(
    async (items: DashboardWidgetId[]) => {
      if (!firestore || !user?.uid || !companyId || !layoutRef) return;
      await setDoc(
        layoutRef,
        {
          userId: user.uid,
          organizationId: companyId,
          items,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [firestore, user?.uid, companyId, layoutRef]
  );

  const resetLayout = useCallback(async () => {
    await saveOrder([...DEFAULT_DASHBOARD_WIDGET_ORDER]);
  }, [saveOrder]);

  return { order, saveOrder, resetLayout, isLoading, userId: user?.uid ?? null };
}
