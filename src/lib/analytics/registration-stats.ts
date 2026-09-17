import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

function toMs(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

export async function countOrganizationsRegisteredSince(
  db: Firestore,
  sinceMs: number
): Promise<number> {
  const snap = await db.collection(COMPANIES_COLLECTION).orderBy("createdAt", "desc").limit(500).get();
  let n = 0;
  for (const doc of snap.docs) {
    const ms = toMs(doc.data()?.createdAt);
    if (ms != null && ms >= sinceMs) n += 1;
  }
  return n;
}

export async function registrationSeries(
  db: Firestore,
  days: number
): Promise<{ date: string; count: number }[]> {
  const snap = await db.collection(COMPANIES_COLLECTION).orderBy("createdAt", "desc").limit(800).get();
  const map = new Map<string, number>();
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const doc of snap.docs) {
    const ms = toMs(doc.data()?.createdAt);
    if (ms == null) continue;
    const key = new Date(ms).toISOString().slice(0, 10);
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}
