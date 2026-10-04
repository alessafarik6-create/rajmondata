import { OPENAI_REALTIME_CALLS_URL } from "@/lib/ai/openai-realtime-api";

const LOG = "[VOICE]";

export type OpenAiErrorInfo = {
  httpStatus: number;
  requestId: string | null;
  errorType: string | null;
  errorCode: string | null;
  message: string;
};

export function parseOpenAiErrorBody(
  httpStatus: number,
  bodyText: string,
  requestId: string | null
): OpenAiErrorInfo {
  let errorType: string | null = null;
  let errorCode: string | null = null;
  let message = bodyText.trim().slice(0, 500);

  try {
    const j = JSON.parse(bodyText) as {
      error?: { message?: string; type?: string; code?: string };
    };
    if (j.error) {
      errorType = j.error.type ?? null;
      errorCode = j.error.code ?? null;
      message = String(j.error.message ?? message).trim();
    }
  } catch {
    /* plain text SDP or html */
  }

  return { httpStatus, requestId, errorType, errorCode, message };
}

/** Pro logy — bez API klíčů a bearer tokenů. */
export function sanitizeOpenAiResponseBodyForLog(bodyText: string, maxLen = 2000): string {
  let out = bodyText.trim().slice(0, maxLen);
  out = out.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]");
  return out;
}

export function logVoiceOpenAiConfig(): void {
  console.log("[VOICE CONFIG]", {
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1",
    voice: process.env.OPENAI_REALTIME_VOICE || "marin",
  });
}

function logVoiceOpenAiError(
  res: Response,
  bodyText: string,
  model: string,
  info: OpenAiErrorInfo
): void {
  const requestId = res.headers.get("x-request-id") ?? res.headers.get("openai-request-id");
  console.error("[VOICE OPENAI ERROR]", {
    status: res.status,
    statusText: res.statusText,
    requestId,
    model: process.env.OPENAI_REALTIME_MODEL || model || "gpt-realtime-2.1",
    errorType: info.errorType,
    errorCode: info.errorCode,
    sanitizedMessage: info.message.slice(0, 500),
    body: sanitizeOpenAiResponseBodyForLog(bodyText),
  });
}

export async function openAiRealtimeCallsExchange(params: {
  apiKey: string;
  sdpOffer: string;
  sessionJson: string;
  model?: string;
  safetyIdentifier?: string | null;
}): Promise<
  | { ok: true; answerSdp: string; requestId: string | null }
  | { ok: false; info: OpenAiErrorInfo }
> {
  const url = OPENAI_REALTIME_CALLS_URL();
  const model = params.model ?? "gpt-realtime-2.1";
  console.info(LOG, "realtime request start", { endpoint: "realtime/calls", model });

  const sdp = params.sdpOffer;
  const formData = new FormData();
  formData.append("sdp", sdp);
  formData.append("session", params.sessionJson);

  console.log("[VOICE] OpenAI realtime request", {
    endpoint: url,
    model: process.env.OPENAI_REALTIME_MODEL || model,
    sdpPresent: formData.has("sdp"),
    sessionPresent: formData.has("session"),
    sdpLength: sdp.length,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
  };
  const sid = String(params.safetyIdentifier ?? "").trim();
  if (sid) headers["OpenAI-Safety-Identifier"] = sid;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  const requestId =
    res.headers.get("x-request-id") ??
    res.headers.get("openai-request-id") ??
    null;
  const bodyText = await res.text();

  if (!res.ok) {
    const info = parseOpenAiErrorBody(res.status, bodyText, requestId);
    logVoiceOpenAiError(res, bodyText, model, info);
    return { ok: false, info };
  }

  if (!bodyText.trim().startsWith("v=")) {
    const info = parseOpenAiErrorBody(res.status, bodyText, requestId);
    logVoiceOpenAiError(res, bodyText, model, {
      ...info,
      message: info.message || "OpenAI nevrátilo platné SDP answer.",
    });
    return {
      ok: false,
      info: {
        ...info,
        message: info.message || "OpenAI nevrátilo platné SDP answer.",
      },
    };
  }

  console.info(LOG, "OpenAI SDP answer received", { requestId, bytes: bodyText.length, model });
  return { ok: true, answerSdp: bodyText, requestId };
}
