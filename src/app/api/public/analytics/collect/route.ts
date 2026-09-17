import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { recordPublicAnalyticsEvent, type AnalyticsEventName } from "@/lib/analytics/collect-server";
import { normalizePublicPath, isBotUserAgent } from "@/lib/analytics/public-paths";
import { bucketReferrer, deviceClassFromUa } from "@/lib/analytics/referrer-bucket";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { SECURITY_THRESHOLDS } from "@/lib/security/security-config";
import { clientIpFromHeaders, hashIp } from "@/lib/security/ip-hash";

const ALLOWED_EVENTS = new Set<string>([
  "pageview",
  "funnel_homepage",
  "funnel_cta_try",
  "funnel_cta_register",
  "funnel_register_open",
  "funnel_register_success",
  "click_login",
  "click_pricing",
  "click_features",
]);

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const ua = request.headers.get("user-agent") || "";
  if (isBotUserAgent(ua)) {
    return NextResponse.json({ ok: true, bot: true });
  }

  const ip = clientIpFromHeaders(request.headers);
  const ipHash = hashIp(ip);
  const rl = await checkFirestoreRateLimit(db, `analytics:${ipHash}`, {
    limit: SECURITY_THRESHOLDS.analyticsCollect.count,
    windowMs: SECURITY_THRESHOLDS.analyticsCollect.windowMs,
  });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = String(body.event ?? "pageview");
  if (!ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const path = normalizePublicPath(String(body.path ?? "/"));
  if (!path) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const visitorId = String(body.visitorId ?? "").trim().slice(0, 64);
  if (!visitorId || visitorId.length < 8) {
    return NextResponse.json({ error: "invalid_visitor" }, { status: 400 });
  }

  const referrerHost = String(body.referrerHost ?? "").trim().slice(0, 120);
  const country = request.headers.get("x-vercel-ip-country")?.slice(0, 2) || undefined;

  try {
    await recordPublicAnalyticsEvent(db, {
      event: event as AnalyticsEventName,
      path,
      referrerBucket: bucketReferrer(referrerHost),
      deviceClass: deviceClassFromUa(ua),
      country,
      utmSource: String(body.utmSource ?? "").slice(0, 80) || undefined,
      utmMedium: String(body.utmMedium ?? "").slice(0, 80) || undefined,
      utmCampaign: String(body.utmCampaign ?? "").slice(0, 80) || undefined,
      visitorId,
    });
  } catch (e) {
    console.error("[analytics/collect]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
