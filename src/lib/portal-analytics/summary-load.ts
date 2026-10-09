import type { Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION,
  PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION,
} from "@/lib/firestore-collections";

export type PortalAnalyticsDailyRow = {
  date: string;
  events: Record<string, number>;
  modules: Record<string, number>;
  devices: Record<string, number>;
  workflows: Record<string, number>;
  uniqueUsersEstimate?: number;
};

function dateKeysForRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function parseDateRangeQuery(input: {
  from?: string | null;
  to?: string | null;
  days?: number;
}): { from: Date; to: Date; dayKeys: string[] } {
  const to = input.to ? new Date(input.to) : new Date();
  const days = input.days && input.days > 0 ? Math.min(input.days, 366) : 30;
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - (days - 1) * 86400000);
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to, dayKeys: dateKeysForRange(from, to) };
}

function rowFromSnap(id: string, data: Record<string, unknown>): PortalAnalyticsDailyRow {
  return {
    date: String(data.date ?? id.slice(0, 10)),
    events: (data.events as Record<string, number>) ?? {},
    modules: (data.modules as Record<string, number>) ?? {},
    devices: (data.devices as Record<string, number>) ?? {},
    workflows: (data.workflows as Record<string, number>) ?? {},
    uniqueUsersEstimate: Object.keys((data.userHashes as Record<string, boolean>) ?? {}).length,
  };
}

export async function loadGlobalPortalAnalyticsRange(
  db: Firestore,
  dayKeys: string[]
): Promise<PortalAnalyticsDailyRow[]> {
  if (dayKeys.length === 0) return [];
  const refs = dayKeys.map((d) =>
    db.collection(PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION).doc(d)
  );
  const snaps = await db.getAll(...refs);
  return snaps
    .filter((s) => s.exists)
    .map((s) => rowFromSnap(s.id, s.data() as Record<string, unknown>));
}

export async function loadOrgPortalAnalyticsRange(
  db: Firestore,
  organizationId: string,
  dayKeys: string[]
): Promise<PortalAnalyticsDailyRow[]> {
  if (dayKeys.length === 0) return [];
  const refs = dayKeys.map((d) =>
    db.collection(PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION).doc(`${d}_${organizationId}`)
  );
  const snaps = await db.getAll(...refs);
  return snaps
    .filter((s) => s.exists)
    .map((s) => rowFromSnap(s.id, s.data() as Record<string, unknown>));
}

export function mergeDailyMaps(
  rows: PortalAnalyticsDailyRow[],
  field: "events" | "modules" | "devices" | "workflows"
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const m = row[field];
    for (const [k, v] of Object.entries(m)) {
      out[k] = (out[k] ?? 0) + (typeof v === "number" ? v : 0);
    }
  }
  return out;
}

export function sumEvent(rows: PortalAnalyticsDailyRow[], eventName: string): number {
  let n = 0;
  for (const row of rows) {
    n += row.events[eventName] ?? 0;
  }
  return n;
}

export function countActiveDays(rows: PortalAnalyticsDailyRow[]): number {
  return rows.filter((r) => {
    const total = Object.values(r.events).reduce((a, b) => a + b, 0);
    return total > 0;
  }).length;
}

export function estimateActiveUsers(rows: PortalAnalyticsDailyRow[]): number {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.uniqueUsersEstimate && row.uniqueUsersEstimate > 0) {
      set.add(`${row.date}:${row.uniqueUsersEstimate}`);
    }
  }
  if (set.size === 0) return 0;
  return Math.max(...rows.map((r) => r.uniqueUsersEstimate ?? 0));
}

/** Unikátní organizace s alespoň jednou událostí v daném dni (z org denních docs). */
export async function countActiveOrganizationsOnDay(
  db: Firestore,
  dateKey: string
): Promise<number> {
  const prefix = `${dateKey}_`;
  const snap = await db
    .collection(PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION)
    .where("date", "==", dateKey)
    .limit(2000)
    .get()
    .catch(async () => {
      const all = await db.collection(PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION).limit(500).get();
      return {
        docs: all.docs.filter((d) => d.id.startsWith(prefix)),
      } as FirebaseFirestore.QuerySnapshot;
    });
  return snap.docs.length;
}
