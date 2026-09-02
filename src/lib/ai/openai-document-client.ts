/**
 * OpenAI Responses API — extrakce dokladu z obrázku/PDF (server-only).
 */

import {
  getOpenAiApiKey,
  getOpenAiDocumentModel,
  OPENAI_REQUEST_TIMEOUT_MS,
} from "@/lib/ai/config";
import { DOCUMENT_AI_JSON_SCHEMA } from "@/lib/ai/document-extraction-schema";
import { DOCUMENT_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/document-extraction-system-prompt";
import { OpenAiClientError } from "@/lib/ai/openai-client";
import type { AiTokenUsage } from "@/lib/ai/types";

export type DocumentAiOpenAiResult = {
  outputText: string;
  model: string;
  usage: AiTokenUsage;
  requestDurationMs: number;
};

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

function parseUsage(data: Record<string, unknown>): AiTokenUsage {
  const usage = data.usage as Record<string, unknown> | undefined;
  if (!usage) return { inputTokens: null, outputTokens: null, totalTokens: null };
  return {
    inputTokens:
      typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : typeof usage.prompt_tokens === "number"
          ? usage.prompt_tokens
          : null,
    outputTokens:
      typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : typeof usage.completion_tokens === "number"
          ? usage.completion_tokens
          : null,
    totalTokens:
      typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

function logOpenAiError(
  res: Response,
  data: Record<string, unknown>,
  rawText: string
): void {
  const errObj = (data.error ?? {}) as Record<string, unknown>;
  console.error("[OpenAI document]", {
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

function userMessageForStatus(status: number, detail: string): string {
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
  return "Analýza dokladu se nezdařila. Zkuste to znovu.";
}

export type DocumentAiInputContent =
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "pdf"; base64: string; fileName: string }
  | { kind: "pdf_text"; text: string; fileName: string };

export async function analyzeDocumentWithOpenAi(
  input: DocumentAiInputContent,
  opts?: { model?: string; companyName?: string }
): Promise<DocumentAiOpenAiResult> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.error("[OpenAI document] OpenAI API key is not configured");
    throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");
  }

  const model = opts?.model ?? getOpenAiDocumentModel();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  const userText =
    "Extrahuj obchodní údaje z tohoto dokladu. Vrať JSON dle schématu. " +
    (opts?.companyName
      ? `Organizace v CRM: ${opts.companyName}. direction expense = faktura od dodavatele (náklad), income = vydaný doklad.`
      : "");

  const contentParts: Array<Record<string, unknown>> = [
    { type: "input_text", text: userText },
  ];

  if (input.kind === "image") {
    contentParts.push({
      type: "input_image",
      image_url: `data:${input.mimeType};base64,${input.base64}`,
    });
  } else if (input.kind === "pdf") {
    contentParts.push({
      type: "input_file",
      filename: input.fileName || "document.pdf",
      file_data: `data:application/pdf;base64,${input.base64}`,
    });
  } else {
    contentParts.push({
      type: "input_text",
      text: `Text extrahovaný z PDF (${input.fileName}):\n\n${input.text.slice(0, 12000)}`,
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
        input: [{ role: "user", content: contentParts }],
        text: {
          format: {
            type: "json_schema",
            name: "document_extraction",
            strict: true,
            schema: DOCUMENT_AI_JSON_SCHEMA,
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
        userMessageForStatus(res.status, detail),
        detail
      );
    }

    return {
      outputText: extractOutputText(data),
      model: String(data.model ?? model),
      usage: parseUsage(data),
      requestDurationMs,
    };
  } catch (err) {
    if (err instanceof OpenAiClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenAiClientError(
        504,
        "Analýza dokladu trvala příliš dlouho. Zkuste to znovu."
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
