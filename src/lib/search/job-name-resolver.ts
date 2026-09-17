/**
 * Rozpoznání zakázky podle názvu v search dotazu (tenant-scoped).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { normalizeSearchText } from "@/lib/search/normalize";

export type ResolvedJobs = {
  jobIds: string[];
  jobNamesById: Record<string, string>;
  primaryJobName: string | null;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function resolveJobsForSearchQuery(
  db: Firestore,
  companyId: string,
  jobQuery: string | null,
  fallbackFromRaw: string | null
): Promise<ResolvedJobs> {
  const needle = (jobQuery?.trim() || fallbackFromRaw?.trim() || "").slice(0, 80);
  if (!needle || needle.length < 2) {
    return { jobIds: [], jobNamesById: {}, primaryJobName: null };
  }

  const normNeedle = normalizeSearchText(needle);
  const needleTokens = normNeedle.split(/\s+/).filter((t) => t.length >= 3);

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .orderBy("updatedAt", "desc")
    .limit(350)
    .get()
    .catch(async () =>
      db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").limit(350).get()
    );

  type Match = { id: string; name: string; score: number };
  const matches: Match[] = [];

  for (const doc of snap.docs) {
    const name = str((doc.data() as { name?: string }).name);
    if (!name) continue;
    const normName = normalizeSearchText(name);

    let score = 0;
    if (normName.includes(normNeedle)) score = 100;
    else if (needleTokens.length) {
      let hits = 0;
      for (const t of needleTokens) {
        if (normName.includes(t)) hits++;
      }
      if (hits === needleTokens.length) score = 85;
      else if (hits > 0) score = 45 + hits * 15;
    }

    if (score > 0) matches.push({ id: doc.id, name, score });
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "cs"));
  const top = matches.slice(0, 8);
  const jobNamesById: Record<string, string> = {};
  for (const m of top) jobNamesById[m.id] = m.name;

  return {
    jobIds: top.map((m) => m.id),
    jobNamesById,
    primaryJobName: top[0]?.name ?? null,
  };
}
