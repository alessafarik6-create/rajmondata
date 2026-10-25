import {
  getOpenAiApiKey,
  getOpenAiDocumentModel,
  OPENAI_REQUEST_TIMEOUT_MS,
} from "@/lib/ai/config";
import { OpenAiClientError } from "@/lib/ai/openai-client";
import { CHAT_WORK_INTENT_JSON_SCHEMA } from "@/lib/chat/chat-work-intent-schema";
import { CHAT_WORK_INTENT_SYSTEM_PROMPT } from "@/lib/chat/chat-work-intent-prompt";
import type { AiTokenUsage } from "@/lib/ai/types";
import type { DocumentAiInputContent } from "@/lib/ai/openai-document-client";

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

export function buildChatWorkIntentOpenAiContentParts(params: {
  messageText: string;
  referenceDateIso: string;
  timeZone: string;
  media: DocumentAiInputContent[];
  imageTilesSent?: number;
}): Array<Record<string, unknown>> {
  const userIntro =
    `Referenční datum a čas zprávy: ${params.referenceDateIso} (${params.timeZone}).\n` +
    `Text zprávy:\n${params.messageText.slice(0, 8000) || "(bez textu — analyzuj pouze přílohy)"}\n` +
    (params.imageTilesSent
      ? `\nPříloha je rozdělena na ${params.imageTilesSent} částí — projdi všechny.\n`
      : "");

  const contentParts: Array<Record<string, unknown>> = [
    { type: "input_text", text: userIntro },
  ];

  for (const input of params.media) {
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
        text: `Text z PDF (${input.fileName}):\n${input.text.slice(0, 12000)}`,
      });
    }
  }
  return contentParts;
}

export async function analyzeChatWorkIntentWithOpenAi(params: {
  messageText: string;
  referenceDateIso: string;
  timeZone: string;
  media: DocumentAiInputContent[];
  imageTilesSent?: number;
}): Promise<{ outputText: string; model: string; usage: AiTokenUsage }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");
  }

  const model = getOpenAiDocumentModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  const contentParts = buildChatWorkIntentOpenAiContentParts(params);
  const imageParts = contentParts.filter((p) => p.type === "input_image");
  if (params.media.some((m) => m.kind === "image") && imageParts.length === 0) {
    throw new OpenAiClientError(
      422,
      "Obrázek se nepodařilo připravit pro AI analýzu."
    );
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
        instructions: CHAT_WORK_INTENT_SYSTEM_PROMPT,
        input: [{ role: "user", content: contentParts }],
        text: {
          format: {
            type: "json_schema",
            name: "chat_work_intent",
            strict: true,
            schema: CHAT_WORK_INTENT_JSON_SCHEMA,
          },
        },
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      data = { error: { message: rawText.slice(0, 500) } };
    }

    if (!res.ok) {
      const errObj = data.error as Record<string, unknown> | undefined;
      const detail = String(errObj?.message ?? rawText).slice(0, 400);
      throw new OpenAiClientError(res.status, "Analýza chatu se nezdařila.", detail);
    }

    return {
      outputText: extractOutputText(data),
      model: String(data.model ?? model),
      usage: parseUsage(data),
    };
  } catch (err) {
    if (err instanceof OpenAiClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenAiClientError(504, "Analýza trvala příliš dlouho.");
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
