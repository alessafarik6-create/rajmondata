/**
 * Generování odpovědí ze znalostní báze (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import { getOpenAiApiKey, getOpenAiModel, OPENAI_REQUEST_TIMEOUT_MS } from "@/lib/ai/config";
import type { KnowledgeQueryIntent } from "@/lib/ai/knowledge-query-intent";
import {
  retrieveKnowledgeForQuery,
  type AiKnowledgeHit,
} from "@/lib/ai/knowledge-service";
import { OpenAiClientError } from "@/lib/ai/openai-client";

const KNOWLEDGE_ANSWER_SYSTEM = `Jsi firemní asistent RajmonData pro odpovědi z nahraných manuálů a technických dokumentů.

PRAVIDLA:
- Odpovídej POUZE z poskytnutých úryvků z firemní znalostní báze.
- Pokud úryvky neobsahují spolehlivou odpověď, nastav found=false a answer prázdný.
- Nevymýšlej technické detaily, rozměry, postupy ani materiály.
- Odpovídej česky, stručně a srozumitelně pro montéra nebo obchodníka.
- V odpovědi můžeš citovat fakt z textu, ale neuváděj interní ID chunků.
- Pokud found=true, odpověď musí být podložená alespoň jedním zdrojem.

Vrať pouze validní JSON dle schématu.`;

const KNOWLEDGE_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    answer: { type: "string" },
    source_indexes: {
      type: "array",
      items: { type: "integer" },
    },
  },
  required: ["found", "answer", "source_indexes"],
} as const;

export type KnowledgeAnswerSource = {
  documentId: string;
  documentTitle: string;
  fileName: string;
  pageNumber: number | null;
  excerpt: string;
  score: number;
  hasVisualContent: boolean;
  downloadUrl: string | null;
  openUrl: string;
};

export type KnowledgeAnswerResult = {
  found: boolean;
  answerText: string;
  sources: KnowledgeAnswerSource[];
  relatedSources: KnowledgeAnswerSource[];
  needsVisualContext: boolean;
  primarySource: KnowledgeAnswerSource | null;
  debug?: {
    query: string;
    topChunks: Array<{
      documentTitle: string;
      pageNumber: number | null;
      score: number;
      excerpt: string;
    }>;
  };
};

const MIN_ANSWER_SCORE = 0.52;

function buildOpenUrl(
  companyId: string,
  documentId: string,
  pageNumber: number | null,
  downloadUrl: string | null
): string {
  if (downloadUrl && pageNumber != null) {
    return `${downloadUrl}#page=${pageNumber}`;
  }
  return `/portal/ai-center?tab=knowledge&doc=${encodeURIComponent(documentId)}${pageNumber != null ? `&page=${pageNumber}` : ""}`;
}

function hitsToSources(hits: AiKnowledgeHit[], companyId: string): KnowledgeAnswerSource[] {
  return hits.map((h) => ({
    documentId: h.documentId,
    documentTitle: h.documentTitle,
    fileName: h.fileName,
    pageNumber: h.pageNumber,
    excerpt: h.text.slice(0, 400),
    score: h.score,
    hasVisualContent: h.hasVisualContent,
    downloadUrl: h.downloadUrl,
    openUrl: buildOpenUrl(companyId, h.documentId, h.pageNumber, h.downloadUrl),
  }));
}

function dedupeSourcesByPage(sources: KnowledgeAnswerSource[]): KnowledgeAnswerSource[] {
  const seen = new Set<string>();
  const out: KnowledgeAnswerSource[] = [];
  for (const s of sources) {
    const key = `${s.documentId}:${s.pageNumber ?? "x"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function generateAnswerFromHits(
  query: string,
  hits: AiKnowledgeHit[]
): Promise<{ found: boolean; answer: string; sourceIndexes: number[] }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");
  }

  const model = getOpenAiModel();
  const sourcesPayload = hits.map((h, i) => ({
    index: i,
    document: h.documentTitle,
    file: h.fileName,
    page: h.pageNumber,
    excerpt: h.text.slice(0, 700),
  }));

  const userPrompt = [
    "DOTAZ:",
    query,
    "",
    "ZÁKONNÉ ZDROJE (použij pouze tyto):",
    JSON.stringify(sourcesPayload, null, 2),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: KNOWLEDGE_ANSWER_SYSTEM,
        input: userPrompt,
        text: {
          format: {
            type: "json_schema",
            name: "knowledge_answer",
            strict: true,
            schema: KNOWLEDGE_ANSWER_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new OpenAiClientError(res.status, "AI odpověď není validní JSON.");
    }

    if (!res.ok) {
      throw new OpenAiClientError(res.status, "Generování odpovědi ze znalostní báze selhalo.");
    }

    const output = extractOutputText(data);
    const parsed = JSON.parse(output) as {
      found: boolean;
      answer: string;
      source_indexes: number[];
    };

    return {
      found: parsed.found === true,
      answer: String(parsed.answer ?? "").trim(),
      sourceIndexes: Array.isArray(parsed.source_indexes)
        ? parsed.source_indexes.filter((n) => Number.isInteger(n))
        : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractOutputText(data: Record<string, unknown>): string {
  const output = data.output;
  if (!Array.isArray(output)) {
    const text = data.output_text;
    if (typeof text === "string" && text.trim()) return text.trim();
    throw new Error("OpenAI odpověď neobsahuje output.");
  }
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "message" && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") chunks.push(p.text);
      }
    }
  }
  const joined = chunks.join("").trim();
  if (joined) return joined;
  throw new Error("OpenAI odpověď neobsahuje textový výstup.");
}

export async function answerKnowledgeQuestion(
  db: Firestore,
  companyId: string,
  queryText: string,
  intent: KnowledgeQueryIntent,
  opts?: { debug?: boolean; generateAnswer?: boolean }
): Promise<KnowledgeAnswerResult> {
  const hits = await retrieveKnowledgeForQuery(db, companyId, queryText, {
    limit: 8,
    intent,
  });

  const debugChunks = hits.map((h) => ({
    documentTitle: h.documentTitle,
    pageNumber: h.pageNumber,
    score: Math.round(h.score * 1000) / 1000,
    excerpt: h.text.slice(0, 200),
  }));

  if (hits.length === 0 || hits[0].score < MIN_ANSWER_SCORE) {
    return {
      found: false,
      answerText: "V nahraných firemních návodech jsem k této otázce nenašel spolehlivou odpověď.",
      sources: [],
      relatedSources: [],
      needsVisualContext: intent.needsVisualContext,
      primarySource: null,
      debug: opts?.debug ? { query: queryText, topChunks: debugChunks } : undefined,
    };
  }

  const allSources = dedupeSourcesByPage(hitsToSources(hits, companyId));

  if (opts?.generateAnswer === false) {
    const primary = allSources[0] ?? null;
    return {
      found: true,
      answerText: primary?.excerpt ?? "",
      sources: allSources.slice(0, 3),
      relatedSources: allSources.slice(3, 6),
      needsVisualContext: intent.needsVisualContext,
      primarySource: primary,
      debug: opts?.debug ? { query: queryText, topChunks: debugChunks } : undefined,
    };
  }

  try {
    const topForLlm = hits.slice(0, 5);
    const llm = await generateAnswerFromHits(queryText, topForLlm);

    if (!llm.found || !llm.answer) {
      return {
        found: false,
        answerText: "V nahraných firemních návodech jsem k této otázce nenašel spolehlivou odpověď.",
        sources: [],
        relatedSources: allSources.slice(0, 3),
        needsVisualContext: intent.needsVisualContext,
        primarySource: null,
        debug: opts?.debug ? { query: queryText, topChunks: debugChunks } : undefined,
      };
    }

    const usedHits = llm.sourceIndexes
      .map((i) => hits[i])
      .filter((h): h is AiKnowledgeHit => h != null);
    const usedSources =
      usedHits.length > 0
        ? dedupeSourcesByPage(hitsToSources(usedHits, companyId))
        : allSources.slice(0, 2);

    const primary = usedSources[0] ?? allSources[0] ?? null;

    return {
      found: true,
      answerText: llm.answer,
      sources: usedSources.slice(0, 4),
      relatedSources: allSources
        .filter((s) => !usedSources.some((u) => u.documentId === s.documentId && u.pageNumber === s.pageNumber))
        .slice(0, 3),
      needsVisualContext: intent.needsVisualContext,
      primarySource: primary,
      debug: opts?.debug ? { query: queryText, topChunks: debugChunks } : undefined,
    };
  } catch (err) {
    console.error("[knowledge-answer]", err instanceof Error ? err.message : err);
    const primary = allSources[0] ?? null;
    return {
      found: primary != null,
      answerText: primary?.excerpt ?? "V nahraných firemních návodech jsem k této otázce nenašel spolehlivou odpověď.",
      sources: allSources.slice(0, 3),
      relatedSources: allSources.slice(3, 6),
      needsVisualContext: intent.needsVisualContext,
      primarySource: primary,
      debug: opts?.debug ? { query: queryText, topChunks: debugChunks } : undefined,
    };
  }
}
