/**
 * Načtení kandidátů přímo ze zdrojových Firestore kolekcí (bez search_index).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  buildSearchIndexFromEntity,
  ENTITY_COLLECTION_MAP,
} from "@/lib/search/index-builders";
import type { SearchEntityType, SearchIndexDoc } from "@/lib/search/types";

const LIVE_ENTITY_TYPES: SearchEntityType[] = [
  "invoice",
  "document",
  "offer",
  "inquiry",
  "job",
  "customer",
  "product",
];

export async function countCompanySearchIndexRecords(
  db: Firestore,
  companyId: string
): Promise<{ total: number; byType: Record<string, number> }> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("search_index")
    .limit(2000)
    .get();

  const byType: Record<string, number> = {};
  for (const d of snap.docs) {
    const t = String(d.data()?.entityType ?? "unknown");
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return { total: snap.size, byType };
}

export async function countCompanySourceEntities(
  db: Firestore,
  companyId: string
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const entityType of LIVE_ENTITY_TYPES) {
    const col = ENTITY_COLLECTION_MAP[entityType];
    if (!col) continue;
    try {
      const agg = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection(col)
        .count()
        .get();
      out[entityType] = agg.data().count ?? 0;
    } catch {
      const snap = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection(col)
        .limit(500)
        .get();
      out[entityType] = snap.size;
    }
  }
  return out;
}

export async function loadLiveSearchCandidates(
  db: Firestore,
  companyId: string,
  opts?: {
    entityTypes?: SearchEntityType[] | null;
    limitPerType?: number;
  }
): Promise<SearchIndexDoc[]> {
  const limitPerType = opts?.limitPerType ?? 80;
  const types = opts?.entityTypes?.length
    ? opts.entityTypes.filter((t) => LIVE_ENTITY_TYPES.includes(t))
    : LIVE_ENTITY_TYPES;

  const results: SearchIndexDoc[] = [];

  for (const entityType of types) {
    const col = ENTITY_COLLECTION_MAP[entityType];
    if (!col) continue;

    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(col)
      .orderBy("__name__")
      .limit(limitPerType)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (entityType === "document" && data.isDeleted === true) continue;

      const entry = buildSearchIndexFromEntity(companyId, entityType, doc.id, data);
      if (entry) {
        entry.companyId = companyId;
        results.push(entry);
      }
    }
  }

  return results;
}
