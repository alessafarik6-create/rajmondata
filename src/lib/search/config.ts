/**
 * Konfigurace CRM vyhledávání (server-only).
 */

export function getOpenAiSearchModel(): string {
  return (
    String(process.env.OPENAI_SEARCH_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini").trim() ||
    "gpt-4.1-mini"
  );
}

export function getOpenAiEmbeddingModel(): string {
  return String(process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small").trim();
}

export const SEARCH_MAX_RESULTS = 40;
export const SEARCH_INDEX_FETCH_LIMIT = 800;
export const SEARCH_SEMANTIC_CANDIDATE_LIMIT = 120;
export const SEARCH_MIN_SEMANTIC_SCORE = 0.72;
