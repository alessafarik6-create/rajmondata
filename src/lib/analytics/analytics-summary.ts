import type { Firestore } from "firebase-admin/firestore";
import { PLATFORM_ANALYTICS_DAILY_COLLECTION } from "@/lib/firestore-collections";

export type DailyAnalyticsRow = {
  date: string;
  pageviews: number;
  visits: number;
  uniqueVisitors: number;
  pages: Record<string, number>;
  referrers: Record<string, number>;
  devices: Record<string, number>;
  countries: Record<string, number>;
  funnel: Record<string, number>;
};

function decodePath(key: string): string {
  if (key === "_root_") return "/";
  return key.replace(/_root_/g, "/");
}

export function normalizeDailyDoc(id: string, data: Record<string, unknown>): DailyAnalyticsRow {
  return {
    date: id,
    pageviews: typeof data.pageviews === "number" ? data.pageviews : 0,
    visits: typeof data.visits === "number" ? data.visits : 0,
    uniqueVisitors: typeof data.uniqueVisitors === "number" ? data.uniqueVisitors : 0,
    pages: (data.pages as Record<string, number>) ?? {},
    referrers: (data.referrers as Record<string, number>) ?? {},
    devices: (data.devices as Record<string, number>) ?? {},
    countries: (data.countries as Record<string, number>) ?? {},
    funnel: (data.funnel as Record<string, number>) ?? {},
  };
}

export async function loadAnalyticsDailyRange(
  db: Firestore,
  days: number
): Promise<DailyAnalyticsRow[]> {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  const snaps = await Promise.all(
    keys.map((k) => db.collection(PLATFORM_ANALYTICS_DAILY_COLLECTION).doc(k).get())
  );
  return snaps
    .map((s) => (s.exists ? normalizeDailyDoc(s.id, s.data() as Record<string, unknown>) : null))
    .filter(Boolean)
    .reverse() as DailyAnalyticsRow[];
}

export function aggregateTopPages(rows: DailyAnalyticsRow[], limit = 15) {
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.pages)) {
      const path = decodePath(k);
      map.set(path, (map.get(path) ?? 0) + v);
    }
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, views]) => ({
      path,
      views,
      sharePct: Math.round((views / total) * 1000) / 10,
    }));
}

export function sumRows(rows: DailyAnalyticsRow[]) {
  return rows.reduce(
    (acc, r) => ({
      pageviews: acc.pageviews + r.pageviews,
      visits: acc.visits + r.visits,
      uniqueVisitors: acc.uniqueVisitors + r.uniqueVisitors,
    }),
    { pageviews: 0, visits: 0, uniqueVisitors: 0 }
  );
}

export function mergeMaps(rows: DailyAnalyticsRow[], field: keyof DailyAnalyticsRow) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const m = r[field] as Record<string, number>;
    for (const [k, v] of Object.entries(m ?? {})) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}
