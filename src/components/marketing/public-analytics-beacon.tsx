"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const VISITOR_KEY = "rajmondata_vid_v1";

function getVisitorId(): string {
  try {
    let id = sessionStorage.getItem(VISITOR_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `v_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

function referrerHost(): string {
  try {
    if (!document.referrer) return "";
    return new URL(document.referrer).hostname;
  } catch {
    return "";
  }
}

export function trackPublicEvent(
  event: string,
  path?: string
) {
  const visitorId = getVisitorId();
  if (visitorId === "anonymous") return;
  const params = new URLSearchParams(window.location.search);
  void fetch("/api/public/analytics/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event,
      path: path ?? window.location.pathname,
      referrerHost: referrerHost(),
      visitorId,
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
    }),
    keepalive: true,
  }).catch(() => {});
}

export function PublicAnalyticsBeacon() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith("/portal") || pathname.startsWith("/admin")) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;

    if (pathname === "/") {
      trackPublicEvent("funnel_homepage", pathname);
    }
    if (pathname === "/register") {
      trackPublicEvent("funnel_register_open", pathname);
    }

    trackPublicEvent("pageview", pathname);
  }, [pathname, searchParams]);

  return null;
}
