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
  console.info(LOG, "realtime request start", { endpoint: "realtime/calls" });
  console.info(LOG, "model", { model });

  const fd = new FormData();
  fd.set(
    "sdp",
    new Blob([params.sdpOffer], { type: "application/sdp" }),
    "offer.sdp"
  );
  fd.set("session", params.sessionJson);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
  };
  const sid = String(params.safetyIdentifier ?? "").trim();
  if (sid) headers["OpenAI-Safety-Identifier"] = sid;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: fd,
  });

  const requestId =
    res.headers.get("x-request-id") ??
    res.headers.get("openai-request-id") ??
    null;
  const bodyText = await res.text();

  if (!res.ok) {
    const info = parseOpenAiErrorBody(res.status, bodyText, requestId);
    console.error("[VOICE OPENAI ERROR]", {
      status: res.status,
      statusText: res.statusText,
      body: bodyText.slice(0, 2000),
      model,
      requestId,
      errorType: info.errorType,
      errorCode: info.errorCode,
    });
    console.error(LOG, "OpenAI HTTP status", res.status);
    if (requestId) console.error(LOG, "OpenAI request id", requestId);
    if (info.errorType) console.error(LOG, "OpenAI error type", info.errorType);
    if (info.errorCode) console.error(LOG, "OpenAI error code", info.errorCode);
    console.error(LOG, "sanitized OpenAI error message", info.message.slice(0, 300));
    return { ok: false, info };
  }

  if (!bodyText.trim().startsWith("v=")) {
    const info = parseOpenAiErrorBody(res.status, bodyText, requestId);
    console.error("[VOICE OPENAI ERROR]", {
      status: res.status,
      statusText: "invalid_sdp_answer",
      body: bodyText.slice(0, 2000),
      model,
      requestId,
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
