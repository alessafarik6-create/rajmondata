import { getOpenAiApiKey, getOpenAiRealtimeModel } from "@/lib/ai/config";
import { OPENAI_REALTIME_CLIENT_SECRETS_URL } from "@/lib/ai/openai-realtime-api";
import { secretarySystemInstructions, type SecretaryContext } from "@/lib/ai/secretary/context";
import { secretaryRealtimeToolDefinitions } from "@/lib/ai/secretary/tools/run-tool";

export type RealtimeClientSecret = {
  ephemeralKey: string;
  expiresAt: number | null;
  model: string;
};

const LOG = "[VOICE]";

function voiceServerLog(message: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(LOG, message, detail);
  } else {
    console.info(LOG, message);
  }
}

function voiceServerError(message: string, detail?: string) {
  console.error(LOG, message, detail ?? "");
}

export function mapRealtimeSessionErrorForClient(raw: string): string {
  const t = raw.trim();
  if (!t) return "Hlasovou asistentku se nepodařilo připojit.";
  if (/invalid url.*realtime\/sessions/i.test(t)) {
    return "Hlasovou asistentku se nepodařilo připojit.";
  }
  if (/openai api není nakonfigurováno/i.test(t)) {
    return "OpenAI API není nakonfigurováno.";
  }
  if (/401|invalid api key|incorrect api key/i.test(t)) {
    return "Hlasovou asistentku se nepodařilo připojit.";
  }
  if (/429|rate limit/i.test(t)) {
    return "Hlasová služba je dočasně přetížená. Zkuste to za chvíli.";
  }
  return "Hlasovou asistentku se nepodařilo připojit.";
}

export async function createOpenAiRealtimeClientSecret(
  ctx: SecretaryContext
): Promise<RealtimeClientSecret> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("OpenAI API není nakonfigurováno.");

  const model = getOpenAiRealtimeModel();
  const voice = String(process.env.OPENAI_REALTIME_VOICE ?? "marin").trim() || "marin";
  const instructions = secretarySystemInstructions(ctx);
  const tools = secretaryRealtimeToolDefinitions();

  const sessionBody = {
    expires_after: {
      anchor: "created_at" as const,
      seconds: 600,
    },
    session: {
      type: "realtime" as const,
      model,
      instructions,
      tools,
      tool_choice: "auto" as const,
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "cs",
          },
          turn_detection: {
            type: "server_vad" as const,
            interrupt_response: true,
            create_response: true,
            silence_duration_ms: 500,
          },
        },
        output: {
          voice,
        },
      },
    },
  };

  const url = OPENAI_REALTIME_CLIENT_SECRETS_URL();
  voiceServerLog("session request", { endpoint: "client_secrets", model });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sessionBody),
  });

  const data = (await res.json().catch(() => ({}))) as {
    value?: string;
    client_secret?: { value?: string; expires_at?: number };
    expires_at?: number;
    error?: { message?: string; type?: string; code?: string };
  };

  if (!res.ok) {
    const apiMsg = String(data.error?.message ?? "").trim();
    voiceServerError("OpenAI client_secrets failed", `HTTP ${res.status} ${apiMsg}`);
    throw new Error(apiMsg || `Realtime client_secrets HTTP ${res.status}`);
  }

  const ephemeralKey =
    String(data.value ?? "").trim() ||
    String(data.client_secret?.value ?? "").trim();

  if (!ephemeralKey) {
    voiceServerError("OpenAI client_secrets empty key", JSON.stringify(data).slice(0, 500));
    throw new Error("Realtime API nevrátilo ephemeral key.");
  }

  voiceServerLog("OpenAI session created", {
    model,
    keyPrefix: ephemeralKey.slice(0, 6),
  });

  return {
    ephemeralKey,
    expiresAt: data.expires_at ?? data.client_secret?.expires_at ?? null,
    model,
  };
}

/** @deprecated alias */
export async function createOpenAiRealtimeSession(ctx: SecretaryContext) {
  const s = await createOpenAiRealtimeClientSecret(ctx);
  return {
    clientSecret: s.ephemeralKey,
    expiresAt: s.expiresAt,
    model: s.model,
  };
}
