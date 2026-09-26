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
import { registerPwaServiceWorker } from "@/lib/pwa-install";
import {
  detectPushPlatform,
  probeLocalPushSubscription,
  urlBase64ToUint8Array,
} from "@/lib/web-push-client";
import type { PortalNotificationCategory } from "@/lib/portal-notifications-types";

export type PortalNotificationItem = {
  id: string;
  category: PortalNotificationCategory;
  type: string | null;
  entityType: string | null;
  entityId: string | null;
  title: string;
  body: string;
  linkUrl: string | null;
  targetType: string | null;
  targetId: string | null;
  targetUrl: string | null;
  jobId: string | null;
  messageId: string | null;
  commentId: string | null;
  conversationId: string | null;
  documentId: string | null;
  invoiceId: string | null;
  inquiryId: string | null;
  calendarEventId: string | null;
  read: boolean;
  createdAt: unknown;
};

export type PushRegisterResult = {
  ok: boolean;
  message: string;
};

export type PushDeviceSummary = {
  id: string;
  label: string;
  platform: string;
  deviceName: string;
  isCurrentDevice: boolean;
};

export type PushDiagnostics = {
  vapidConfigured: boolean;
  subscriptionActive: boolean;
  /** Platná subscription v PushManager na tomto zařízení. */
  localDevicePushActive: boolean;
  /** Server má uloženou subscription pro aktuální endpoint. */
  serverRegisteredThisDevice: boolean;
  activeDeviceCount: number;
  devices: PushDeviceSummary[];
  lastPushError: string | null;
  permission: NotificationPermission | "unsupported";
  deviceLabel: string;
  iosHomeScreenHint: boolean;
};

type PortalNotificationsContextValue = {
  unreadCount: number;
  items: PortalNotificationItem[];
  isLoading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearOsBadge: () => void;
  registerWebPush: () => Promise<PushRegisterResult>;
  sendTestPush: (scope?: "current" | "all") => Promise<PushRegisterResult>;
  refreshPushDiagnostics: () => Promise<void>;
  pushSupported: boolean;
  pushDiagnostics: PushDiagnostics;
};

const defaultDiagnostics: PushDiagnostics = {
  vapidConfigured: false,
  subscriptionActive: false,
  localDevicePushActive: false,
  serverRegisteredThisDevice: false,
  activeDeviceCount: 0,
  devices: [],
  lastPushError: null,
  permission: "unsupported",
  deviceLabel: "—",
  iosHomeScreenHint: false,
};

const PortalNotificationsContext = createContext<PortalNotificationsContextValue | null>(null);

export function PortalNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { firestore } = useFirebase();
  const [pushSupported, setPushSupported] = useState(false);
  const [pushDiagnostics, setPushDiagnostics] = useState<PushDiagnostics>(defaultDiagnostics);

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
    const list = (inboxRows ?? []) as Array<Record<string, unknown> & { id: string }>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return list.map((row) => ({
      id: row.id,
      category: (typeof row.category === "string" ? row.category : "system") as PortalNotificationCategory,
      type: str(row.type),
      entityType: str(row.entityType),
      entityId: str(row.entityId),
      title: typeof row.title === "string" ? row.title : "Oznámení",
      body: typeof row.body === "string" ? row.body : "",
      linkUrl: str(row.linkUrl),
      targetType: str(row.targetType),
      targetId: str(row.targetId),
      targetUrl: str(row.targetUrl),
      jobId: str(row.jobId),
      messageId: str(row.messageId),
      commentId: str(row.commentId) ?? str(row.messageId),
      conversationId: str(row.conversationId),
      documentId: str(row.documentId),
      invoiceId: str(row.invoiceId),
      inquiryId: str(row.inquiryId),
      calendarEventId: str(row.calendarEventId),
      read: row.read === true,
      createdAt: row.createdAt,
    }));
  }, [inboxRows]);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);

  useEffect(() => {
    if (!user) {
      clearAppBadgeSafe();
      return;
    }
    applyAppBadgeCount(unreadCount);
  }, [user, unreadCount]);

  useEffect(() => {
    const platform = detectPushPlatform();
    setPushSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        typeof Notification !== "undefined"
    );
    setPushDiagnostics((d) => ({
      ...d,
      deviceLabel: `${platform.deviceName} / ${platform.platform}`,
      iosHomeScreenHint: platform.iosHomeScreenHint,
      permission:
        typeof Notification !== "undefined" ? Notification.permission : "unsupported",
    }));
    registerPwaServiceWorker();
  }, []);

  const refreshPushDiagnostics = useCallback(async () => {
    if (!user) return;
    const platform = detectPushPlatform();
    let permission: NotificationPermission | "unsupported" =
      typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    const localDevicePushActive = await probeLocalPushSubscription();
    let currentEndpoint: string | null = null;
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        currentEndpoint = sub?.endpoint ?? null;
      }
    } catch {
      currentEndpoint = null;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/notifications/push-status", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currentEndpoint }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPushDiagnostics({
          vapidConfigured: Boolean(data.vapidConfigured && data.vapidValid),
          subscriptionActive: Boolean(data.subscriptionActive),
          localDevicePushActive,
          serverRegisteredThisDevice: Boolean(data.serverRegisteredThisDevice),
          activeDeviceCount: Number(data.activeDeviceCount ?? 0),
          devices: Array.isArray(data.devices) ? data.devices : [],
          lastPushError: data.lastPushError ?? null,
          permission,
          deviceLabel: `${platform.deviceName} / ${platform.platform}`,
          iosHomeScreenHint: platform.iosHomeScreenHint,
        });
        return;
      }
    } catch {
      /* ignore */
    }
    setPushDiagnostics((d) => ({
      ...d,
      permission,
      localDevicePushActive,
      serverRegisteredThisDevice: false,
      deviceLabel: `${platform.deviceName} / ${platform.platform}`,
      iosHomeScreenHint: platform.iosHomeScreenHint,
    }));
  }, [user]);

  useEffect(() => {
    if (user) void refreshPushDiagnostics();
  }, [user, refreshPushDiagnostics]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!firestore || !user) return;
      await updateDoc(doc(firestore, "users", user.uid, "notificationInbox", id), {
        read: true,
        readAt: serverTimestamp(),
      });
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
    clearAppBadgeSafe();
  }, [firestore, user, items]);

  const clearOsBadge = useCallback(() => {
    clearAppBadgeSafe();
  }, []);

  const registerWebPush = useCallback(async (): Promise<PushRegisterResult> => {
    if (!user || typeof window === "undefined") {
      return { ok: false, message: "Nejste přihlášeni." };
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, message: "Tento prohlížeč nepodporuje Web Push." };
    }
    const platform = detectPushPlatform();
    if (platform.iosHomeScreenHint) {
      return {
        ok: false,
        message:
          "Na iPhone/iPad funguje Web Push až po přidání aplikace na Domovskou obrazovku (iOS 16.4+) a povolení oznámení.",
      };
    }

    registerPwaServiceWorker();
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    } catch {
      return { ok: false, message: "Service worker se nepodařilo registrovat (vyžaduje HTTPS)." };
    }

    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      return { ok: false, message: "Oprávnění k oznámením nebylo uděleno." };
    }

    const vapidRes = await fetch("/api/notifications/vapid-public");
    const vapidJson = (await vapidRes.json()) as { publicKey?: string; error?: string };
    if (!vapidRes.ok || !vapidJson.publicKey) {
      return {
        ok: false,
        message:
          vapidJson.error ||
          "Administrátorská konfigurace push oznámení není dokončena (chybí VAPID klíče na serveru).",
      };
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidJson.publicKey),
      });
    }

    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) return { ok: false, message: "Relace vypršela — přihlaste se znovu." };
    const token = await u.getIdToken();
    const r = await fetch("/api/notifications/subscribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[registerWebPush] subscribe API failed", r.status, errText);
      return { ok: false, message: "Uložení subscription na server selhalo." };
    }

    await refreshPushDiagnostics();
    return { ok: true, message: "Push oznámení jsou aktivní na tomto zařízení." };
  }, [user, refreshPushDiagnostics]);

  const sendTestPush = useCallback(
    async (scope: "current" | "all" = "current"): Promise<PushRegisterResult> => {
      if (!user) return { ok: false, message: "Nejste přihlášeni." };
      let currentEndpoint: string | null = null;
      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          currentEndpoint = sub?.endpoint ?? null;
        }
      } catch {
        currentEndpoint = null;
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/notifications/test-push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope,
          currentEndpoint: scope === "current" ? currentEndpoint : undefined,
        }),
      });
      const data = await res.json();
      await refreshPushDiagnostics();
      if (!res.ok || !data.ok) {
        return { ok: false, message: data.error || data.message || "Test selhal." };
      }
      return { ok: true, message: data.message || "Test odeslán." };
    },
    [user, refreshPushDiagnostics]
  );

  const value = useMemo<PortalNotificationsContextValue>(
    () => ({
      unreadCount,
      items,
      isLoading: Boolean(user) && isLoading,
      markAsRead,
      markAllRead,
      clearOsBadge,
      registerWebPush,
      sendTestPush,
      refreshPushDiagnostics,
      pushSupported,
      pushDiagnostics,
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
      sendTestPush,
      refreshPushDiagnostics,
      pushSupported,
      pushDiagnostics,
    ]
  );

  return (
    <PortalNotificationsContext.Provider value={value}>{children}</PortalNotificationsContext.Provider>
  );
}

export function usePortalNotifications(): PortalNotificationsContextValue {
  const ctx = useContext(PortalNotificationsContext);
  if (!ctx) {
    throw new Error("usePortalNotifications must be used within PortalNotificationsProvider");
  }
  return ctx;
}

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
      registerWebPush: async () => ({ ok: false, message: "" }),
      sendTestPush: async () => ({ ok: false, message: "" }),
      refreshPushDiagnostics: async () => {},
      pushSupported: false,
      pushDiagnostics: defaultDiagnostics,
    }
  );
}
