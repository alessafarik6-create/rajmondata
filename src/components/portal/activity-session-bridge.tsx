"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import {
  createOrResumeStaffSession,
  staffSessionStorageKey,
} from "@/lib/activity-log";

/**
 * Zahájí / obnoví Firestore relaci a udržuje lastSeen. Nepřekáží při chybě služeb.
 */
export function ActivitySessionBridge() {
  const pathname = usePathname() || "/";
  const { user } = useUser();
  const firestore = useFirestore();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user || !firestore || !companyId?.trim()) return;
    void createOrResumeStaffSession({
      firestore,
      companyId,
      user,
      profile,
      route: pathname,
    }).catch(() => {});
  }, [user?.uid, companyId, firestore, pathname, profile]);

  useEffect(() => {
    if (!user || !firestore || !companyId?.trim()) return;
    const tick = () => {
      if (typeof sessionStorage === "undefined") return;
      const sid = sessionStorage.getItem(staffSessionStorageKey(companyId, user.uid));
      if (!sid) return;
      void updateDoc(
        doc(firestore, "companies", companyId, "staffSessions", sid),
        {
          lastSeenAt: serverTimestamp(),
          lastRoute: pathname.slice(0, 500),
        }
      ).catch(() => {});
    };
    intervalRef.current = window.setInterval(tick, 60_000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [user?.uid, companyId, firestore, pathname]);

  useEffect(() => {
    if (!user || !firestore || !companyId?.trim()) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const sid =
        typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(staffSessionStorageKey(companyId, user.uid))
          : null;
      if (!sid) return;
      void updateDoc(
        doc(firestore, "companies", companyId, "staffSessions", sid),
        {
          lastSeenAt: serverTimestamp(),
          lastRoute: pathname.slice(0, 500),
        }
      ).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [user?.uid, companyId, firestore, pathname]);

  return null;
}
