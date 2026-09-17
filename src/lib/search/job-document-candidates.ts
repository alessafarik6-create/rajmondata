/**
 * Dokumenty / média vázaná na konkrétní zakázky (live load pro file search).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { buildDocumentSearchIndex } from "@/lib/search/index-builders";
import type { SearchIndexDoc } from "@/lib/search/types";

export async function loadJobLinkedDocumentCandidates(
  db: Firestore,
  companyId: string,
  jobIds: string[],
  limitPerJob = 60
): Promise<SearchIndexDoc[]> {
  if (!jobIds.length) return [];

  const out: SearchIndexDoc[] = [];
  const seen = new Set<string>();

  for (const jobId of jobIds.slice(0, 5)) {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("documents")
      .where("jobId", "==", jobId)
      .limit(limitPerJob)
      .get()
      .catch(() => null);

    if (!snap) continue;
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (data.isDeleted === true) continue;
      const key = `document_${doc.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = buildDocumentSearchIndex(companyId, doc.id, data);
      if (entry) {
        entry.companyId = companyId;
        out.push(entry);
      }
    }
  }

  return out;
}
