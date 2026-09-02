/**
 * OpenAI embeddings pro semantic search (server-only).
 */

import { createHash } from "crypto";
import { getOpenAiApiKey } from "@/lib/ai/config";
import { getOpenAiEmbeddingModel } from "@/lib/search/config";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export type EmbeddingOutcome =
  | { ok: true; embedding: number[]; model: string }
  | { ok: false; error: string };

const embeddingCache = new Map<string, number[]>();

export function embeddingCacheKey(text: string, model: string): string {
  return createHash("sha256").update(`${model}:${text}`, "utf8").digest("hex");
}

export async function computeEmbeddingForText(text: string): Promise<EmbeddingOutcome> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return { ok: false, error: "OpenAI API key není nakonfigurován." };
  }

  const model = getOpenAiEmbeddingModel();
  const input = text.trim().slice(0, 8000);
  if (input.length < 3) {
    return { ok: false, error: "Text je příliš krátký pro embedding." };
  }

  const cacheKey = embeddingCacheKey(input, model);
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    return { ok: true, embedding: cached, model };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof (data.error as { message?: string } | undefined)?.message === "string"
          ? (data.error as { message: string }).message
          : `HTTP ${res.status}`;
      console.error("[search/embeddings]", msg);
      return { ok: false, error: "Embedding se nezdařil." };
    }

    const row = Array.isArray(data.data) ? (data.data[0] as Record<string, unknown>) : null;
    const embedding = row?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { ok: false, error: "Prázdný embedding." };
    }

    const vec = embedding.map((v) => Number(v));
    embeddingCache.set(cacheKey, vec);
    return { ok: true, embedding: vec, model };
  } catch (err) {
    console.error("[search/embeddings]", errorMessageFromUnknown(err));
    return { ok: false, error: "Embedding se nezdařil." };
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
