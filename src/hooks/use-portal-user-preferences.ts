"use client";

import { useCallback, useMemo } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase";
import {
  parsePortalUserPreferences,
  type PortalUserPreferences,
} from "@/lib/portal-user-preferences";

type UserDoc = Record<string, unknown> & {
  portalPreferences?: PortalUserPreferences;
};

export function usePortalUserPreferences() {
  const firestore = useFirestore();
  const { user } = useUser();

  const userRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: userDoc, isLoading } = useDoc<UserDoc>(userRef);

  const preferences = useMemo(
    () => parsePortalUserPreferences(userDoc ?? null),
    [userDoc]
  );

  const patchPreferences = useCallback(
    async (patch: Partial<PortalUserPreferences>) => {
      if (!firestore || !user?.uid || !userRef) return;
      const prev = parsePortalUserPreferences(userDoc ?? null);
      const next: PortalUserPreferences = { ...prev, ...patch };
      await setDoc(
        userRef,
        {
          portalPreferences: next,
          portalPreferencesUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [firestore, user?.uid, userRef, userDoc]
  );

  return {
    preferences,
    isLoading,
    setAiSecretaryCollapsed: (collapsed: boolean) =>
      patchPreferences({ aiSecretaryCollapsed: collapsed }),
    setDashboardModuleOrder: (dashboardModuleOrder: string[]) =>
      patchPreferences({ dashboardModuleOrder }),
    patchPreferences,
  };
}
