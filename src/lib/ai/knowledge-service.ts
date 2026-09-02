/**
 * Zpracování a retrieval znalostní báze pro AI (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  AI_KNOWLEDGE_CHUNKS_COLLECTION,
  AI_KNOWLEDGE_DOCUMENTS_COLLECTION,
  type AiKnowledgeChunkDoc,
  type AiKnowledgeDocumentDoc,
  type AiKnowledgeCategory,
} from "@/lib/ai/ai-center-types";
import { computeEmbeddingForText, cosineSimilarity } from "@/lib/search/embeddings";
import { extractKnowledgeDocumentText } from "@/lib/ai/knowledge-text-extract";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

export type AiKnowledgeHit = {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  text: string;
  score: number;
};

function splitIntoChunks(text: string): string[] {
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
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4) : undefined,
    });
    return;
  }
  console.info(`[knowledge] ${stage}`, meta);
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

  await docRef.set(
    {
      status: "processing",
      errorMessage: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    logStage("PDF_TEXT_EXTRACTION_START", { companyId, documentId, mimeType, fileName });

    const extracted = await extractKnowledgeDocumentText(
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

    logStage("PDF_TEXT_EXTRACTION_OK", {
      companyId,
      documentId,
      source: extracted.source,
      textLength: extracted.text.length,
    });

    const chunks = splitIntoChunks(extracted.text);
    if (chunks.length === 0) {
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

    logStage("CHUNKING_OK", { companyId, documentId, chunkCount: chunks.length });

    const chunksCol = docRef.collection(AI_KNOWLEDGE_CHUNKS_COLLECTION);
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      for (const d of existing.docs) batch.delete(d.ref);
      await batch.commit();
    }

    logStage("EMBEDDING_START", { companyId, documentId, chunkCount: chunks.length });

    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i];
      const emb = await computeEmbeddingForText(chunkText);
      const payload: Omit<AiKnowledgeChunkDoc, "id"> = {
        companyId,
        documentId,
        chunkIndex: i,
        text: chunkText,
        embedding: emb.ok ? emb.embedding : null,
        embeddingModel: emb.ok ? emb.model : null,
        tokenEstimate: Math.ceil(chunkText.length / 4),
        createdAt: FieldValue.serverTimestamp(),
      };
      await chunksCol.doc(String(i)).set(payload);
    }

    logStage("EMBEDDING_OK", { companyId, documentId, chunkCount: chunks.length });

    await docRef.set(
      {
        status: "ready",
        chunkCount: chunks.length,
        errorMessage: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logStage("DATABASE_SAVE_OK", { companyId, documentId, chunkCount: chunks.length });

    return { ok: true, chunkCount: chunks.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Zpracování selhalo.";
    logStage("PROCESSING_FAILED", { companyId, documentId, stage: "processKnowledgeDocument" }, err);
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
  logStage("KNOWLEDGE_UPLOAD_START", {
    companyId: params.companyId,
    userId: params.uploadedByUid,
    documentId: params.documentId,
    filename: params.fileName,
    mimeType: params.mimeType,
    size: params.fileSizeBytes,
  });

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
    logStage("FILE_UPLOAD_OK", {
      companyId: params.companyId,
      documentId: params.documentId,
      bytes: buffer.length,
    });
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
  limit = 6
): Promise<AiKnowledgeHit[]> {
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
  const hits: AiKnowledgeHit[] = [];

  for (const doc of docsSnap.docs) {
    const chunksSnap = await doc.ref.collection(AI_KNOWLEDGE_CHUNKS_COLLECTION).limit(80).get();
    const meta = docMeta.get(doc.id);
    for (const chunkDoc of chunksSnap.docs) {
      const chunk = chunkDoc.data() as AiKnowledgeChunkDoc;
      let score = 0;
      if (queryEmb.ok && Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
        score = cosineSimilarity(queryEmb.embedding, chunk.embedding);
      } else {
        const q = queryText.toLowerCase();
        const t = chunk.text.toLowerCase();
        const tokens = q.split(/\s+/).filter((w) => w.length >= 4);
        score = tokens.filter((w) => t.includes(w)).length * 0.05;
      }
      if (score <= 0) continue;
      hits.push({
        documentId: doc.id,
        documentTitle: meta?.title ?? doc.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text.slice(0, 900),
        score,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
