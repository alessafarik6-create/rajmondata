"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { useCollection, useMemoFirebase, useUser, useFirebase } from "@/firebase";
import { applyAppBadgeCount, clearAppBadgeSafe } from "@/lib/app-badge";
import { urlBase64ToUint8Array } from "@/lib/web-push-client";
import type { PortalNotificationCategory } from "@/lib/portal-notifications-types";

export type PortalNotificationItem = {
  id: string;
  category: PortalNotificationCategory;
  title: string;
  body: string;
  linkUrl: string | null;
  read: boolean;
  createdAt: unknown;
};

type PortalNotificationsContextValue = {
  unreadCount: number;
  items: PortalNotificationItem[];
  isLoading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Po otevření aplikace — smaže odznak na ikoně (Badging API). */
  clearOsBadge: () => void;
  registerWebPush: () => Promise<boolean>;
  pushSupported: boolean;
};

const PortalNotificationsContext = createContext<PortalNotificationsContextValue | null>(
  null
);

export function PortalNotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useUser();
  const { firestore } = useFirebase();
  const [pushSupported, setPushSupported] = useState(false);

  const inboxQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, "users", user.uid, "notificationInbox"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
  }, [firestore, user?.uid]);

  const { data: inboxRows, isLoading } = useCollection(inboxQuery);

  const items: PortalNotificationItem[] = useMemo(() => {
    const list = (inboxRows ?? []) as Array<
      Record<string, unknown> & { id: string }
    >;
    return list.map((row) => ({
      id: row.id,
      category: (typeof row.category === "string"
        ? row.category
        : "system") as PortalNotificationCategory,
      title: typeof row.title === "string" ? row.title : "Oznámení",
      body: typeof row.body === "string" ? row.body : "",
      linkUrl:
        typeof row.linkUrl === "string" && row.linkUrl.trim()
          ? row.linkUrl.trim()
          : null,
      read: row.read === true,
      createdAt: row.createdAt,
    }));
  }, [inboxRows]);

  const unreadCount = useMemo(
    () => items.filter((i) => !i.read).length,
    [items]
  );

  useEffect(() => {
    if (!user) {
      clearAppBadgeSafe();
      return;
    }
    applyAppBadgeCount(unreadCount);
  }, [user, unreadCount]);

  useEffect(() => {
    setPushSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window
    );
  }, []);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!firestore || !user) return;
      await updateDoc(
        doc(firestore, "users", user.uid, "notificationInbox", id),
        {
          read: true,
          readAt: serverTimestamp(),
        }
      );
    },
    [firestore, user]
  );

  const markAllRead = useCallback(async () => {
    if (!firestore || !user) return;
    const unread = items.filter((i) => !i.read);
    if (!unread.length) return;
    const batch = writeBatch(firestore);
    for (const i of unread) {
      batch.update(doc(firestore, "users", user.uid, "notificationInbox", i.id), {
        read: true,
        readAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }, [firestore, user, items]);

  const clearOsBadge = useCallback(() => {
    clearAppBadgeSafe();
  }, []);

  const registerWebPush = useCallback(async (): Promise<boolean> => {
    if (!user || typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    const vapidRes = await fetch("/api/notifications/vapid-public");
    if (!vapidRes.ok) return false;
    const data = (await vapidRes.json()) as { publicKey?: string };
    if (!data.publicKey) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
    }

    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) return false;
    const token = await u.getIdToken();
    const r = await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sub.toJSON()),
    });
    return r.ok;
  }, [user?.uid]);

  const value = useMemo<PortalNotificationsContextValue>(
    () => ({
      unreadCount,
      items,
      isLoading: Boolean(user) && isLoading,
      markAsRead,
      markAllRead,
      clearOsBadge,
      registerWebPush,
      pushSupported,
    }),
    [
      unreadCount,
      items,
      user,
      isLoading,
      markAsRead,
      markAllRead,
      clearOsBadge,
      registerWebPush,
      pushSupported,
    ]
  );

  return (
    <PortalNotificationsContext.Provider value={value}>
      {children}
    </PortalNotificationsContext.Provider>
  );
}

export function usePortalNotifications(): PortalNotificationsContextValue {
  const ctx = useContext(PortalNotificationsContext);
  if (!ctx) {
    throw new Error("usePortalNotifications must be used within PortalNotificationsProvider");
  }
  return ctx;
}

/** V hlavičce — vrátí nuly, pokud provider chybí (nemělo by nastat). */
export function usePortalNotificationsSafe(): PortalNotificationsContextValue {
  const ctx = useContext(PortalNotificationsContext);
  return (
    ctx ?? {
      unreadCount: 0,
      items: [],
      isLoading: false,
      markAsRead: async () => {},
      markAllRead: async () => {},
      clearOsBadge: () => {},
      registerWebPush: async () => false,
      pushSupported: false,
    }
  );
}
