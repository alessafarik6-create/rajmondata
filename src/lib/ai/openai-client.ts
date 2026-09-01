/**
 * OpenAI Responses API klient (server-only).
 */

import {
  getOpenAiApiKey,
  getOpenAiModel,
  OPENAI_REQUEST_TIMEOUT_MS,
} from "@/lib/ai/config";
import { AI_QUOTE_JSON_SCHEMA } from "@/lib/ai/inquiry-quote-schema";
import { INQUIRY_QUOTE_SYSTEM_PROMPT } from "@/lib/ai/inquiry-quote-system-prompt";
import type { AiTokenUsage } from "@/lib/ai/types";

export type OpenAiQuoteGenerationResult = {
  outputText: string;
  model: string;
  usage: AiTokenUsage;
  requestDurationMs: number;
};

export class OpenAiClientError extends Error {
  readonly statusCode: number;
  readonly userMessage: string;

  constructor(statusCode: number, userMessage: string, detail?: string) {
    super(detail ?? userMessage);
    this.name = "OpenAiClientError";
    this.statusCode = statusCode;
    this.userMessage = userMessage;
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
        if (p.type === "output_text" && typeof p.text === "string") {
          chunks.push(p.text);
        } else if (typeof p.text === "string") {
          chunks.push(p.text);
        }
      }
    }
  }
  const joined = chunks.join("").trim();
  if (joined) return joined;

  throw new Error("OpenAI odpověď neobsahuje textový výstup.");
}

function parseUsage(data: Record<string, unknown>): AiTokenUsage {
  const usage = data.usage as Record<string, unknown> | undefined;
  if (!usage) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const inputTokens =
    typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : null;
  const outputTokens =
    typeof usage.output_tokens === "number"
      ? usage.output_tokens
      : typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null;
  const totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : null;
  return { inputTokens, outputTokens, totalTokens };
}

function logOpenAiError(
  res: Response,
  data: Record<string, unknown>,
  rawText: string
): void {
  const errObj = (data.error ?? {}) as Record<string, unknown>;
  console.error("[OpenAI] request failed", {
    httpStatus: res.status,
    errorType: errObj.type ?? null,
    errorCode: errObj.code ?? null,
    errorMessage:
      typeof errObj.message === "string"
        ? errObj.message.slice(0, 500)
        : rawText.slice(0, 500),
    requestId:
      (typeof data.id === "string" ? data.id : null) ??
      res.headers.get("x-request-id"),
  });
}

function userMessageForOpenAiStatus(status: number, detail: string): string {
  if (status === 429) {
    return "Byl překročen limit požadavků na AI. Zkuste to prosím později.";
  }
  if (status === 401 || status === 403) {
    return "OpenAI API není správně nakonfigurováno.";
  }
  if (status === 400) {
    if (/invalid.*schema|json_schema|required/i.test(detail)) {
      return "AI služba odmítla požadavek (neplatné schéma odpovědi).";
    }
    return "AI služba odmítla požadavek.";
  }
  return "Generování AI návrhu se nezdařilo. Zkuste to znovu.";
}

export async function generateInquiryQuoteWithOpenAi(
  userPrompt: string,
  opts?: { model?: string; instructions?: string }
): Promise<OpenAiQuoteGenerationResult> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.error("[OpenAI] OpenAI API key is not configured");
    throw new OpenAiClientError(
      503,
      "OpenAI API není nakonfigurováno."
    );
  }

  const model = opts?.model ?? getOpenAiModel();
  const instructions = opts?.instructions ?? INQUIRY_QUOTE_SYSTEM_PROMPT;
  const started = Date.now();

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
        instructions,
        input: userPrompt,
        text: {
          format: {
            type: "json_schema",
            name: "inquiry_quote_draft",
            strict: true,
            schema: AI_QUOTE_JSON_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });

    const requestDurationMs = Date.now() - started;
    const rawText = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      data = { error: { message: rawText.slice(0, 500) } };
    }

    if (!res.ok) {
      logOpenAiError(res, data, rawText);
      const errObj = data.error as Record<string, unknown> | undefined;
      const detail = String(errObj?.message ?? rawText).slice(0, 400);
      throw new OpenAiClientError(
        res.status,
        userMessageForOpenAiStatus(res.status, detail),
        detail
      );
    }

    const outputText = extractOutputText(data);
    return {
      outputText,
      model: String(data.model ?? model),
      usage: parseUsage(data),
      requestDurationMs,
    };
  } catch (err) {
    if (err instanceof OpenAiClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenAiClientError(
        504,
        "AI odpověď trvala příliš dlouho. Zkuste to znovu."
      );
    }
    throw new OpenAiClientError(
      502,
      "Nepodařilo se spojit s AI službou.",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}
