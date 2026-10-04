/**
 * OpenAI Realtime API — absolutní URL (nikdy relativní /v1/...).
 */

const DEFAULT_ORIGIN = "https://api.openai.com/v1";

export function getOpenAiV1Origin(): string {
  const raw = String(process.env.OPENAI_API_BASE_URL ?? DEFAULT_ORIGIN).trim();
  if (!raw) return DEFAULT_ORIGIN;
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error("OPENAI_API_BASE_URL musí být absolutní URL (https://…).");
  }
  return raw.replace(/\/+$/, "");
}

export function openAiRealtimeUrl(subpath: string): string {
  const origin = getOpenAiV1Origin();
  const path = subpath.startsWith("/") ? subpath : `/${subpath}`;
  return `${origin}${path}`;
}

export const OPENAI_REALTIME_CLIENT_SECRETS_URL = () =>
  openAiRealtimeUrl("/realtime/client_secrets");

export const OPENAI_REALTIME_CALLS_URL = () => openAiRealtimeUrl("/realtime/calls");
