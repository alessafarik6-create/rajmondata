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
} from "@/lib/ai/ai-center-types";
import { computeEmbeddingForText, cosineSimilarity } from "@/lib/search/embeddings";
import { extractPdfTextContent } from "@/lib/ai/document-pdf-text";

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

export async function processKnowledgeDocument(
  db: Firestore,
  companyId: string,
  documentId: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ ok: true; chunkCount: number } | { ok: false; error: string }> {
  const docRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_KNOWLEDGE_DOCUMENTS_COLLECTION)
    .doc(documentId);

  await docRef.update({
    status: "processing",
    errorMessage: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    let text = "";
    if (mimeType.includes("pdf")) {
      text = await extractPdfTextContent(fileBuffer);
    } else if (mimeType.includes("text") || mimeType.includes("plain")) {
      text = fileBuffer.toString("utf8");
    } else {
      text = fileBuffer.toString("utf8");
    }

    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) {
      await docRef.update({
        status: "failed",
        errorMessage: "Dokument neobsahuje extrahovatelný text.",
        chunkCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: false, error: "Dokument neobsahuje extrahovatelný text." };
    }

    const chunksCol = docRef.collection(AI_KNOWLEDGE_CHUNKS_COLLECTION);
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      for (const d of existing.docs) batch.delete(d.ref);
      await batch.commit();
    }

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

    await docRef.update({
      status: "ready",
      chunkCount: chunks.length,
      errorMessage: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, chunkCount: chunks.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Zpracování selhalo.";
    await docRef.update({
      status: "failed",
      errorMessage: msg,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: false, error: msg };
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
