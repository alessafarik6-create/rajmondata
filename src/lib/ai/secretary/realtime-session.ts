import { getOpenAiApiKey, getOpenAiRealtimeModel } from "@/lib/ai/config";
import { secretarySystemInstructions, type SecretaryContext } from "@/lib/ai/secretary/context";
import { secretaryRealtimeToolDefinitions } from "@/lib/ai/secretary/tools/run-tool";
import type { AiSecretarySettingsDoc } from "@/lib/ai/secretary/settings";
import type { SecretaryPermissions } from "@/lib/ai/secretary/permissions";

export type RealtimeClientSecret = {
  ephemeralKey: string;
  expiresAt: number | null;
  model: string;
};

const LOG = "[VOICE]";

function realtimeToolsEnabled(): boolean {
  const flag = String(process.env.OPENAI_REALTIME_ENABLE_TOOLS ?? "true").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no";
}

export function assertOpenAiVoiceConfigured(): { ok: true; model: string } | { ok: false; reason: string } {
  const apiKey = getOpenAiApiKey();
  console.info(LOG, "OPENAI_API_KEY configured:", Boolean(apiKey));
  if (!apiKey) {
    console.error(LOG, "OPENAI_API_KEY missing");
    return { ok: false, reason: "Hlasová AI není na serveru nakonfigurována." };
  }
  const model = getOpenAiRealtimeModel();
  console.info(LOG, "model", { model });
  return { ok: true, model };
}

/** Unified interface: JSON pro FormData pole `session` u POST /v1/realtime/calls */
export function buildUnifiedRealtimeSessionJson(
  ctx: SecretaryContext,
  access?: { settings: AiSecretarySettingsDoc; perms: SecretaryPermissions }
): string {
  const model = getOpenAiRealtimeModel();
  const voice = String(process.env.OPENAI_REALTIME_VOICE ?? "marin").trim() || "marin";
  const instructions = secretarySystemInstructions(ctx);

  const tools = access
    ? secretaryRealtimeToolDefinitions({ settings: access.settings, perms: access.perms })
    : secretaryRealtimeToolDefinitions();

  if (process.env.NODE_ENV === "development") {
    console.info(LOG, "realtime model", { model, toolsCount: tools.length });
  }

  const session: Record<string, unknown> = {
    type: "realtime",
    model,
    instructions,
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          threshold: 0.55,
          prefix_padding_ms: 350,
          silence_duration_ms: 900,
          interrupt_response: true,
          create_response: true,
        },
      },
      output: {
        voice,
      },
    },
  };

  if (realtimeToolsEnabled()) {
    session.tools = tools;
    session.tool_choice = "auto";
  }

  return JSON.stringify(session);
}

export function mapRealtimeSessionErrorForClient(
  raw: string,
  code?: string | null
): string {
  const t = raw.trim();
  if (code === "openai_not_configured") {
    return "Hlasová AI není na serveru nakonfigurována.";
  }
  if (/openai api není nakonfigurováno|OPENAI_API_KEY missing/i.test(t)) {
    return "Hlasová AI není na serveru nakonfigurována.";
  }
  if (/401|invalid api key|incorrect api key/i.test(t)) {
    return "Hlasovou asistentku se nepodařilo připojit.";
  }
  if (/429|rate limit/i.test(t)) {
    return "Hlasová služba je dočasně přetížená. Zkuste to za chvíli.";
  }
  if (!t) return "Hlasovou asistentku se nepodařilo připojit.";
  return "Hlasovou asistentku se nepodařilo připojit.";
}

export function voiceErrorPayloadForClient(info: {
  message: string;
  code: string;
  openAiStatus?: number;
  openAiCode?: string | null;
}) {
  return {
    ok: false as const,
    error: mapRealtimeSessionErrorForClient(info.message, info.code),
    code: info.code,
    openAiStatus: info.openAiStatus ?? null,
    openAiCode: info.openAiCode ?? null,
  };
}

/** Preflight — ověří API key; klient pak volá unified /realtime/calls */
export async function createOpenAiRealtimeClientSecret(
  ctx: SecretaryContext
): Promise<RealtimeClientSecret> {
  const check = assertOpenAiVoiceConfigured();
  if (!check.ok) throw new Error(check.reason);

  const model = check.model;
  console.info(LOG, "session preflight ok", { model, userId: ctx.userId });

  return {
    ephemeralKey: "",
    expiresAt: null,
    model,
  };
}

/** @deprecated alias — unified flow nepotřebuje ephemeral key v browseru */
export async function createOpenAiRealtimeSession(ctx: SecretaryContext) {
  const s = await createOpenAiRealtimeClientSecret(ctx);
  return {
    clientSecret: "",
    expiresAt: s.expiresAt,
    model: s.model,
  };
}
