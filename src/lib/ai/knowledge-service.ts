/**
 * Zpracování a retrieval znalostní báze pro AI (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  AI_KNOWLEDGE_CHUNKS_COLLECTION,
  AI_KNOWLEDGE_DOCUMENTS_COLLECTION,
  type AiKnowledgeCategory,
  type AiKnowledgeChunkDoc,
  type AiKnowledgeDocumentDoc,
} from "@/lib/ai/ai-center-types";
import { computeEmbeddingForText, cosineSimilarity } from "@/lib/search/embeddings";
import {
  extractKnowledgeDocumentPages,
  type KnowledgePageText,
} from "@/lib/ai/knowledge-text-extract";
import type { KnowledgeQueryIntent } from "@/lib/ai/knowledge-query-intent";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

export type AiKnowledgeHit = {
  documentId: string;
  documentTitle: string;
  fileName: string;
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
  score: number;
  category: AiKnowledgeCategory | null;
  hasVisualContent: boolean;
  downloadUrl: string | null;
};

export type RetrieveKnowledgeOptions = {
  limit?: number;
  intent?: KnowledgeQueryIntent;
};

type ChunkCandidate = AiKnowledgeHit & { rawSimilarity: number };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function splitPageIntoChunks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + CHUNK_SIZE);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

function buildPageChunks(pages: KnowledgePageText[]): Array<{
  text: string;
  pageNumber: number | null;
  hasVisualContent: boolean;
}> {
  const out: Array<{ text: string; pageNumber: number | null; hasVisualContent: boolean }> = [];
  for (const page of pages) {
    const parts = splitPageIntoChunks(page.text);
    if (parts.length === 0 && page.text.trim()) {
      out.push({
        text: page.text.trim(),
        pageNumber: page.pageNumber,
        hasVisualContent: page.hasVisualContent,
      });
      continue;
    }
    for (const part of parts) {
      out.push({
        text: part,
        pageNumber: page.pageNumber,
        hasVisualContent: page.hasVisualContent,
      });
    }
  }
  return out;
}

function logStage(
  stage: string,
  meta: Record<string, unknown>,
  err?: unknown
): void {
  if (err) {
    console.error(`[knowledge] ${stage}`, {
      ...meta,
      errorType: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : errorMessageFromUnknown(err),
    });
    return;
  }
  console.info(`[knowledge] ${stage}`, meta);
}

function rerankHit(
  hit: ChunkCandidate,
  queryText: string,
  docMeta: AiKnowledgeDocumentDoc,
  intent?: KnowledgeQueryIntent
): number {
  let score = hit.rawSimilarity;
  const q = normalize(queryText);
  const title = normalize(`${docMeta.title} ${docMeta.fileName}`);
  const chunk = normalize(hit.text);

  const tokens = q.split(/\s+/).filter((w) => w.length >= 3);
  for (const token of tokens) {
    if (title.includes(token)) score += 0.04;
    if (chunk.includes(token)) score += 0.03;
  }

  const upperTokens = queryText.match(/\b[A-Z0-9]{2,8}\b/g) ?? [];
  for (const code of upperTokens) {
    const c = code.toLowerCase();
    if (title.includes(c) || chunk.includes(c)) score += 0.12;
  }

  if (intent?.preferredCategories?.length) {
    if (intent.preferredCategories.includes(docMeta.category)) score += 0.06;
  }

  if (intent?.needsVisualContext && hit.hasVisualContent) {
    score += 0.08;
  }

  if (docMeta.category === "technical" || docMeta.category === "installation") {
    if (intent?.intent === "knowledge_question") score += 0.04;
  }

  return score;
}

export async function processKnowledgeDocument(
  db: Firestore,
  companyId: string,
  documentId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ ok: true; chunkCount: number } | { ok: false; error: string; code?: string }> {
  const docRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
    .doc(documentId);

  const docSnap = await docRef.get();
  const docData = docSnap.data() as Omit<AiKnowledgeDocumentDoc, "id"> | undefined;

  await docRef.set(
    {
      status: "processing",
      errorMessage: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const extracted = await extractKnowledgeDocumentPages(
      db,
      companyId,
      fileBuffer,
      mimeType,
      fileName
    );
    if (!extracted.ok) {
      await docRef.set(
        {
          status: "failed",
          errorMessage: extracted.error,
          chunkCount: 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { ok: false, error: extracted.error, code: "PDF_PROCESSING_FAILED" };
    }

    const pageChunks = buildPageChunks(extracted.pages);
    if (pageChunks.length === 0) {
      await docRef.set(
        {
          status: "failed",
          errorMessage: "Dokument neobsahuje extrahovatelný text.",
          chunkCount: 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { ok: false, error: "Dokument neobsahuje extrahovatelný text.", code: "PDF_PROCESSING_FAILED" };
    }

    const chunksCol = docRef.collection(AI_KNOWLEDGE_CHUNKS_COLLECTION);
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      for (const d of existing.docs) batch.delete(d.ref);
      await batch.commit();
    }

    for (let i = 0; i < pageChunks.length; i += 1) {
      const chunk = pageChunks[i];
      const emb = await computeEmbeddingForText(chunk.text);
      const payload: Omit<AiKnowledgeChunkDoc, "id"> = {
        companyId,
        documentId,
        chunkIndex: i,
        text: chunk.text,
        pageNumber: chunk.pageNumber,
        fileName: docData?.fileName ?? fileName,
        documentTitle: docData?.title ?? fileName,
        category: docData?.category ?? null,
        hasVisualContent: chunk.hasVisualContent,
        embedding: emb.ok ? emb.embedding : null,
        embeddingModel: emb.ok ? emb.model : null,
        tokenEstimate: Math.ceil(chunk.text.length / 4),
        createdAt: FieldValue.serverTimestamp(),
      };
      await chunksCol.doc(String(i)).set(payload);
    }

    await docRef.set(
      {
        status: "ready",
        chunkCount: pageChunks.length,
        pageCount: extracted.pageCount,
        errorMessage: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, chunkCount: pageChunks.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Zpracování selhalo.";
    logStage("PROCESSING_FAILED", { companyId, documentId }, err);
    await docRef.set(
      {
        status: "failed",
        errorMessage: msg,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, error: msg, code: "PDF_PROCESSING_FAILED" };
  }
}

export async function processKnowledgeDocumentFromStorage(
  db: Firestore,
  bucket: { file: (path: string) => { download: () => Promise<[Buffer]> } },
  params: {
    companyId: string;
    documentId: string;
    title: string;
    category: AiKnowledgeCategory;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    storagePath: string;
    downloadUrl: string;
    uploadedByUid: string;
  }
): Promise<{ ok: true; chunkCount: number } | { ok: false; error: string; code?: string }> {
  const docRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
    .doc(params.documentId);

  await docRef.set(
    {
      companyId: params.companyId,
      title: params.title,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storagePath: params.storagePath,
      downloadUrl: params.downloadUrl,
      fileSizeBytes: params.fileSizeBytes,
      category: params.category,
      active: true,
      status: "processing",
      chunkCount: 0,
      errorMessage: null,
      uploadedByUid: params.uploadedByUid,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const [buffer] = await bucket.file(params.storagePath).download();
    return processKnowledgeDocument(
      db,
      params.companyId,
      params.documentId,
      buffer,
      params.mimeType,
      params.fileName
    );
  } catch (err) {
    logStage("FILE_DOWNLOAD_FAILED", { companyId: params.companyId, documentId: params.documentId }, err);
    await docRef.set(
      {
        status: "failed",
        errorMessage: "Soubor se nepodařilo načíst ze storage.",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, error: "Soubor se nepodařilo načíst ze storage.", code: "STORAGE_READ_FAILED" };
  }
}

export async function retrieveKnowledgeForQuery(
  db: Firestore,
  companyId: string,
  queryText: string,
  limitOrOpts: number | RetrieveKnowledgeOptions = 6
): Promise<AiKnowledgeHit[]> {
  const opts: RetrieveKnowledgeOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
  const limit = opts.limit ?? 6;

  const docsSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
    .where("active", "==", true)
    .where("status", "==", "ready")
    .limit(40)
    .get();

  if (docsSnap.empty) return [];

  const docMeta = new Map<string, AiKnowledgeDocumentDoc>();
  for (const d of docsSnap.docs) {
    docMeta.set(d.id, { id: d.id, ...(d.data() as Omit<AiKnowledgeDocumentDoc, "id">) });
  }

  const queryEmb = await computeEmbeddingForText(queryText);
  const hits: ChunkCandidate[] = [];

  for (const doc of docsSnap.docs) {
    const meta = docMeta.get(doc.id)!;
    const chunksSnap = await doc.ref.collection(AI_KNOWLEDGE_CHUNKS_COLLECTION).limit(120).get();

    for (const chunkDoc of chunksSnap.docs) {
      const chunk = chunkDoc.data() as AiKnowledgeChunkDoc;
      let rawSimilarity = 0;

      if (queryEmb.ok && Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        rawSimilarity = cosineSimilarity(queryEmb.embedding, chunk.embedding);
      } else {
        const q = normalize(queryText);
        const t = normalize(chunk.text);
        const tokens = q.split(/\s+/).filter((w) => w.length >= 3);
        rawSimilarity = tokens.filter((w) => t.includes(w)).length * 0.06;
      }

      if (rawSimilarity <= 0) continue;

      const base: ChunkCandidate = {
        documentId: doc.id,
        documentTitle: meta.title ?? chunk.documentTitle ?? doc.id,
        fileName: meta.fileName ?? chunk.fileName ?? "",
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber ?? null,
        text: chunk.text.slice(0, 1200),
        score: rawSimilarity,
        rawSimilarity,
        category: chunk.category ?? meta.category ?? null,
        hasVisualContent: chunk.hasVisualContent === true,
        downloadUrl: meta.downloadUrl ?? null,
      };

      base.score = rerankHit(base, queryText, meta, opts.intent);
      hits.push(base);
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function reindexAllKnowledgeDocuments(
  db: Firestore,
  bucket: { file: (path: string) => { download: () => Promise<[Buffer]> } },
  companyId: string
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
    .where("active", "==", true)
    .limit(100)
    .get();

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as AiKnowledgeDocumentDoc;
    const storagePath = String(data.storagePath ?? "").trim();
    if (!storagePath) {
      failed += 1;
      errors.push(`${data.title || doc.id}: chybí storagePath`);
      continue;
    }
    try {
      const [buffer] = await bucket.file(storagePath).download();
      const res = await processKnowledgeDocument(
        db,
        companyId,
        doc.id,
        buffer,
        data.mimeType,
        data.fileName
      );
      if (res.ok) processed += 1;
      else {
        failed += 1;
        errors.push(`${data.title || doc.id}: ${res.error}`);
      }
    } catch (err) {
      failed += 1;
      errors.push(`${data.title || doc.id}: ${err instanceof Error ? err.message : "selhalo"}`);
    }
  }

  return { processed, failed, errors };
}
