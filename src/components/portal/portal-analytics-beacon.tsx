"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUser, useDoc, useFirestore, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import {
  portalAnalyticsOptInFromProfile,
  setPortalAnalyticsTokenProvider,
  trackPortalAnalyticsEvent,
  trackPortalModuleOpened,
} from "@/lib/portal-analytics/track-client";

/**
 * Sémantická analytika portálu — navigace a události bez obsahu formulářů.
 * Respektuje users.portalAnalyticsOptIn === false.
 */
export function PortalAnalyticsBeacon() {
  const pathname = usePathname() || "/";
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);
  const companyId = String(profile?.companyId ?? "").trim();
  const optedIn = portalAnalyticsOptInFromProfile(profile as Record<string, unknown> | null);
  const lastPath = useRef<string>("");
  const loginSent = useRef(false);

  useEffect(() => {
    if (!user) return;
    setPortalAnalyticsTokenProvider(() => user.getIdToken());
  }, [user]);

  useEffect(() => {
    if (!user?.uid || !companyId || !optedIn) return;
    if (!pathname.startsWith("/portal")) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    trackPortalModuleOpened(pathname, companyId, user.uid);
  }, [pathname, user?.uid, companyId, optedIn]);

  useEffect(() => {
    if (!user?.uid || !companyId || !optedIn) return;
    if (loginSent.current) return;
    loginSent.current = true;
    trackPortalAnalyticsEvent({
      organizationId: companyId,
      userId: user.uid,
      event: "login",
      moduleId: "auth",
    });
  }, [user?.uid, companyId, optedIn]);

  useEffect(() => {
    if (!user?.uid || !companyId || !optedIn) return;
    return () => {
      trackPortalAnalyticsEvent({
        organizationId: companyId,
        userId: user.uid,
        event: "logout",
        moduleId: "auth",
      });
    };
  }, [user?.uid, companyId, optedIn]);

  return null;
}
