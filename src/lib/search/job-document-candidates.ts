/**
 * Dokumenty / média vázaná na konkrétní zakázky (live load pro file search).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { buildDocumentSearchIndex } from "@/lib/search/index-builders";
import type { SearchIndexDoc } from "@/lib/search/types";
import { normalizeSearchText } from "@/lib/search/normalize";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function buildMeasurementPhotoSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>,
  jobNamesById?: Record<string, string>
): SearchIndexDoc | null {
  const jobId = str(data.jobId);
  if (!jobId) return null;

  const fileUrl = str(data.annotatedImageUrl) || str(data.originalImageUrl);
  if (!fileUrl) return null;

  const title = str(data.title) || str(data.note) || `Foto zaměření`;
  const jobName = str(data.jobName) || jobNamesById?.[jobId] || "";
  const note = str(data.note);
  const storagePath = str(data.annotatedStoragePath) || str(data.storagePath);

  const searchText = normalizeSearchText(
    [title, note, jobName, "zamereni", "zaměření", "foto", storagePath].filter(Boolean).join("\n")
  );

  const now = Date.now();
  return {
    companyId,
    entityType: "file",
    entityId: `measurement_${id}`,
    title,
    subtitle: jobName ? `Zakázka: ${jobName}` : null,
    searchText,
    keywords: ["zamereni", "zaměření", "foto", "obraz"],
    exactKeys: [],
    metadata: {
      jobId,
      jobName: jobName || null,
      fileName: title,
      category: "zaměření",
    },
    openUrl: `/portal/jobs/${encodeURIComponent(jobId)}`,
    mimeType: "image/jpeg",
    fileUrl,
    visibleToRoles: ["owner", "admin", "manager", "accountant", "employee"],
    moduleKey: null,
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export async function loadJobLinkedDocumentCandidates(
  db: Firestore,
  companyId: string,
  jobIds: string[],
  jobNamesById?: Record<string, string>,
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

    if (snap) {
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

    const mpSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("measurement_photos")
      .where("jobId", "==", jobId)
      .limit(40)
      .get()
      .catch(() => null);

    if (mpSnap) {
      for (const doc of mpSnap.docs) {
        const key = `measurement_${doc.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = buildMeasurementPhotoSearchIndex(
          companyId,
          doc.id,
          doc.data() as Record<string, unknown>,
          jobNamesById
        );
        if (entry) out.push(entry);
      }
    }
  }

  return out;
}
