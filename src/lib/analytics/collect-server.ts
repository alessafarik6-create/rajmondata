import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_ANALYTICS_DAILY_COLLECTION,
  PLATFORM_ANALYTICS_UNIQUE_DAILY_COLLECTION,
} from "@/lib/firestore-collections";
import { createHash } from "crypto";

export type AnalyticsEventName =
  | "pageview"
  | "funnel_homepage"
  | "funnel_cta_try"
  | "funnel_cta_register"
  | "funnel_register_open"
  | "funnel_register_success"
  | "click_login"
  | "click_pricing"
  | "click_features";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function visitorHash(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 24);
}

function mapKey(raw: string): string {
  return raw.replace(/\//g, "_root_").replace(/\./g, "_").slice(0, 80) || "_root_";
}

function incMap(map: Record<string, number> | undefined, key: string, by = 1) {
  const m = { ...(map ?? {}) };
  m[key] = (m[key] ?? 0) + by;
  return m;
}

export async function recordPublicAnalyticsEvent(
  db: Firestore,
  input: {
    event: AnalyticsEventName;
    path: string;
    referrerBucket: string;
    deviceClass: string;
    country?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    visitorId: string;
  }
): Promise<void> {
  const day = todayKey();
  const dailyRef = db.collection(PLATFORM_ANALYTICS_DAILY_COLLECTION).doc(day);
  const uniqueRef = db
    .collection(PLATFORM_ANALYTICS_UNIQUE_DAILY_COLLECTION)
    .doc(`${day}_${visitorHash(input.visitorId)}`);

  const isPageview = input.event === "pageview";
  const pathKey = mapKey(input.path);
  const refKey = mapKey(input.referrerBucket);
  const devKey = mapKey(input.deviceClass);
  const countryKey = input.country ? mapKey(input.country) : null;
  const utmKey =
    input.utmSource
      ? mapKey(`${input.utmSource}|${input.utmMedium || ""}|${input.utmCampaign || ""}`)
      : null;

  await db.runTransaction(async (tx) => {
    const [dailySnap, uniqueSnap] = await Promise.all([tx.get(dailyRef), tx.get(uniqueRef)]);
    const data = dailySnap.data() as Record<string, unknown> | undefined;
    const pages = (data?.pages as Record<string, number>) ?? {};
    const referrers = (data?.referrers as Record<string, number>) ?? {};
    const devices = (data?.devices as Record<string, number>) ?? {};
    const countries = (data?.countries as Record<string, number>) ?? {};
    const utm = (data?.utm as Record<string, number>) ?? {};
    const funnel = (data?.funnel as Record<string, number>) ?? {};

    let pageviews = typeof data?.pageviews === "number" ? data.pageviews : 0;
    let visits = typeof data?.visits === "number" ? data.visits : 0;
    let uniqueVisitors = typeof data?.uniqueVisitors === "number" ? data.uniqueVisitors : 0;

    const isNewVisitor = !uniqueSnap.exists;

    if (isPageview) {
      pageviews += 1;
      Object.assign(pages, incMap(pages, pathKey));
    }

    Object.assign(funnel, incMap(funnel, input.event));
    Object.assign(referrers, incMap(referrers, refKey));
    Object.assign(devices, incMap(devices, devKey));
    if (countryKey) Object.assign(countries, incMap(countries, countryKey));
    if (utmKey) Object.assign(utm, incMap(utm, utmKey));

    if (isPageview && isNewVisitor) {
      tx.set(uniqueRef, { date: day, createdAt: FieldValue.serverTimestamp() });
      visits += 1;
      uniqueVisitors += 1;
    }

    tx.set(
      dailyRef,
      {
        date: day,
        pageviews,
        visits,
        uniqueVisitors,
        pages,
        referrers,
        devices,
        countries,
        utm,
        funnel,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}
