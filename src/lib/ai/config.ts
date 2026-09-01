/**
 * Konfigurace AI asistenta (server-only).
 */

export const AI_GENERATIONS_COLLECTION = "ai_generations";

export function getOpenAiApiKey(): string | null {
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  return key || null;
}

export function getOpenAiModel(): string {
  return String(process.env.OPENAI_MODEL ?? "gpt-4.1-mini").trim() || "gpt-4.1-mini";
}

/** Maximální sleva v %, kterou AI smí navrhnout (lze později spravovat v admin UI). */
export function getAiMaxDiscountPercent(): number {
  const raw = Number(process.env.AI_MAX_DISCOUNT_PERCENT ?? 15);
  if (!Number.isFinite(raw)) return 15;
  return Math.min(100, Math.max(0, raw));
}

export function isAiFeatureEnabledEnv(): boolean {
  const flag = String(process.env.AI_INQUIRY_QUOTES_ENABLED ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

/** Globální env přepínač; Firestore ai_settings.enabled se kontroluje v quote-generation-service. */
export function isAiFeatureEnabled(): boolean {
  return isAiFeatureEnabledEnv();
}

export const OPENAI_REQUEST_TIMEOUT_MS = 90_000;
