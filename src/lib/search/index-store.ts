/**
 * Ukládání search indexu do Firestore (Admin SDK).
 */

import { createHash } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { SEARCH_INDEX_COLLECTION, searchIndexDocId } from "@/lib/search/types";
import type { SearchEntityType, SearchIndexDoc } from "@/lib/search/types";
import {
  BACKFILL_ENTITY_TYPES,
  buildSearchIndexFromEntity,
  ENTITY_COLLECTION_MAP,
} from "@/lib/search/index-builders";
import { computeEmbeddingForText, type EmbeddingOutcome } from "@/lib/search/embeddings";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function searchIndexRef(db: Firestore, companyId: string, docId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(SEARCH_INDEX_COLLECTION)
    .doc(docId);
}

export async function upsertSearchIndexEntry(
  db: Firestore,
  entry: SearchIndexDoc,
  opts?: { skipEmbedding?: boolean }
): Promise<void> {
  const docId = searchIndexDocId(entry.entityType, entry.entityId);
  const ref = searchIndexRef(db, entry.companyId, docId);
  const existing = await ref.get();
  const prevHash = String(existing.data()?.embeddingHash ?? "");
  const hash = contentHash(entry.searchText);

  let embedding: number[] | null = existing.data()?.embedding ?? null;
  let embeddingHash: string | null = prevHash || null;

  if (!opts?.skipEmbedding && entry.searchText.length >= 20) {
    if (hash !== prevHash || !Array.isArray(embedding) || embedding.length === 0) {
      const emb: EmbeddingOutcome = await computeEmbeddingForText(entry.searchText.slice(0, 8000));
      if (emb.ok) {
        embedding = emb.embedding;
        embeddingHash = hash;
      }
    }
  }

  const payload: Record<string, unknown> = {
    ...entry,
    embedding: embedding ?? null,
    embeddingHash,
    indexedAt: new Date().toISOString(),
  };

  await ref.set(payload, { merge: true });
}

export async function deleteSearchIndexEntry(
  db: Firestore,
  companyId: string,
  entityType: SearchEntityType,
  entityId: string
): Promise<void> {
  const docId = searchIndexDocId(entityType, entityId);
  await searchIndexRef(db, companyId, docId).delete().catch(() => undefined);
}

export async function reindexEntity(
  db: Firestore,
  companyId: string,
  entityType: SearchEntityType,
  entityId: string,
  opts?: { skipEmbedding?: boolean; extraSearchText?: string }
): Promise<{ ok: boolean; reason?: string }> {
  const collectionName = ENTITY_COLLECTION_MAP[entityType];
  if (!collectionName) return { ok: false, reason: "unknown_entity" };

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(collectionName)
    .doc(entityId)
    .get();

  if (!snap.exists) {
    await deleteSearchIndexEntry(db, companyId, entityType, entityId);
    return { ok: true, reason: "deleted" };
  }

  const data = snap.data() as Record<string, unknown>;
  if (opts?.extraSearchText) {
    data.aiSearchText = `${String(data.aiSearchText ?? "")}\n${opts.extraSearchText}`.trim();
  }

  const entry = buildSearchIndexFromEntity(companyId, entityType, entityId, data);
  if (!entry) {
    await deleteSearchIndexEntry(db, companyId, entityType, entityId);
    return { ok: true, reason: "skipped" };
  }

  await upsertSearchIndexEntry(db, entry, opts);
  return { ok: true };
}

export type BackfillProgress = {
  entityType: SearchEntityType;
  processed: number;
  indexed: number;
  skipped: number;
};

export async function backfillCompanySearchIndex(
  db: Firestore,
  companyId: string,
  opts?: {
    entityTypes?: SearchEntityType[];
    batchSize?: number;
    skipEmbedding?: boolean;
    maxPerType?: number;
  }
): Promise<BackfillProgress[]> {
  const types = opts?.entityTypes ?? BACKFILL_ENTITY_TYPES;
  const batchSize = opts?.batchSize ?? 100;
  const results: BackfillProgress[] = [];

  for (const entityType of types) {
    const collectionName = ENTITY_COLLECTION_MAP[entityType];
    if (!collectionName) continue;

    let processed = 0;
    let indexed = 0;
    let skipped = 0;
    let lastDoc: QueryDocumentSnapshot | undefined;

    while (true) {
      if (opts?.maxPerType && processed >= opts.maxPerType) break;

      let q = db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection(collectionName)
        .orderBy("__name__")
        .limit(batchSize);

      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      for (const doc of snap.docs) {
        processed++;
        if (opts?.maxPerType && processed > opts.maxPerType) break;

        const entry = buildSearchIndexFromEntity(
          companyId,
          entityType,
          doc.id,
          doc.data() as Record<string, unknown>
        );
        if (!entry) {
          skipped++;
          await deleteSearchIndexEntry(db, companyId, entityType, doc.id);
          continue;
        }
        await upsertSearchIndexEntry(db, entry, { skipEmbedding: opts?.skipEmbedding });
        indexed++;
      }

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < batchSize) break;
    }

    results.push({ entityType, processed, indexed, skipped });
  }

  return results;
}

export async function loadCompanySearchIndex(
  db: Firestore,
  companyId: string,
  limit = 800
): Promise<SearchIndexDoc[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(SEARCH_INDEX_COLLECTION)
    .orderBy("updatedAtMs", "desc")
    .limit(limit)
    .get()
    .catch(async () => {
      const fallback = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection(SEARCH_INDEX_COLLECTION)
        .limit(limit)
        .get();
      return fallback;
    });

  return snap.docs.map((d) => d.data() as SearchIndexDoc);
}

export async function loadExactKeyMatches(
  db: Firestore,
  companyId: string,
  exactKey: string,
  limit = 20
): Promise<SearchIndexDoc[]> {
  if (!exactKey) return [];
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(SEARCH_INDEX_COLLECTION)
    .where("exactKeys", "array-contains", exactKey)
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as SearchIndexDoc);
}
