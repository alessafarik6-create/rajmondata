"use client";

import { mapPathToAnalyticsModule } from "@/lib/portal-analytics/event-types";

const QUEUE: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let tokenProvider: (() => Promise<string | null>) | null = null;

export function setPortalAnalyticsTokenProvider(fn: () => Promise<string | null>) {
  tokenProvider = fn;
}

function deviceClass(): string {
  if (typeof navigator === "undefined") return "unknown";
  const u = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(u)) return "tablet";
  if (/mobile|android|iphone/.test(u)) return "mobile";
  return "desktop";
}

export function portalAnalyticsOptInFromProfile(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile) return true;
  if (profile.portalAnalyticsOptIn === false) return false;
  return true;
}

export function trackPortalAnalyticsEvent(input: {
  organizationId: string;
  userId: string;
  event: string;
  moduleId?: string;
  actionKey?: string;
}) {
  if (!input.organizationId || !input.userId) return;
  QUEUE.push({
    ...input,
    deviceClass: deviceClass(),
    ts: Date.now(),
  });
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPortalAnalyticsQueue();
  }, 1200);
}

export function trackPortalModuleOpened(pathname: string, organizationId: string, userId: string) {
  trackPortalAnalyticsEvent({
    organizationId,
    userId,
    event: "module_opened",
    moduleId: mapPathToAnalyticsModule(pathname),
  });
}

async function flushPortalAnalyticsQueue() {
  if (QUEUE.length === 0) return;
  const token = tokenProvider ? await tokenProvider().catch(() => null) : null;
  if (!token) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPortalAnalyticsQueue();
    }, 2000);
    return;
  }
  const batch = QUEUE.splice(0, 20);
  for (const item of batch) {
    try {
      await fetch("/api/portal/analytics/collect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify(item),
        keepalive: true,
      });
    } catch {
      /* neblokovat UI */
    }
  }
  if (QUEUE.length > 0) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPortalAnalyticsQueue();
    }, 800);
  }
}
