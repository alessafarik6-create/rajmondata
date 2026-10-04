import { getOpenAiApiKey, getOpenAiRealtimeModel } from "@/lib/ai/config";
import { secretarySystemInstructions, type SecretaryContext } from "@/lib/ai/secretary/context";
import { secretaryRealtimeToolDefinitions } from "@/lib/ai/secretary/tools/run-tool";

export type RealtimeClientSecret = {
  ephemeralKey: string;
  expiresAt: number | null;
  model: string;
};

export async function createOpenAiRealtimeClientSecret(
  ctx: SecretaryContext
): Promise<RealtimeClientSecret> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("OpenAI API není nakonfigurováno.");

  const model = getOpenAiRealtimeModel();
  const voice = String(process.env.OPENAI_REALTIME_VOICE ?? "alloy").trim() || "alloy";
  const instructions = secretarySystemInstructions(ctx);
  const tools = secretaryRealtimeToolDefinitions();

  const sessionBody = {
    session: {
      type: "realtime",
      model,
      instructions,
      tools,
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            interrupt_response: true,
            create_response: true,
          },
        },
        output: {
          voice,
        },
      },
    },
  };

  let ephemeralKey = "";
  let expiresAt: number | null = null;

  const clientSecretRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sessionBody),
  });

  const clientSecretData = (await clientSecretRes.json().catch(() => ({}))) as {
    value?: string;
    client_secret?: { value?: string; expires_at?: number };
    expires_at?: number;
    error?: { message?: string };
  };

  if (clientSecretRes.ok) {
    ephemeralKey =
      String(clientSecretData.value ?? "").trim() ||
      String(clientSecretData.client_secret?.value ?? "").trim();
    expiresAt =
      clientSecretData.expires_at ?? clientSecretData.client_secret?.expires_at ?? null;
  }

  if (!ephemeralKey) {
    const legacyBody = {
      model,
      voice,
      instructions,
      tools,
      turn_detection: { type: "server_vad", interrupt_response: true, create_response: true },
    };
    const legacyRes = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(legacyBody),
    });
    const legacyData = (await legacyRes.json().catch(() => ({}))) as {
      client_secret?: { value?: string; expires_at?: number };
      error?: { message?: string };
    };
    if (!legacyRes.ok) {
      throw new Error(
        legacyData.error?.message ||
          clientSecretData.error?.message ||
          `Realtime session HTTP ${legacyRes.status}`
      );
    }
    ephemeralKey = String(legacyData.client_secret?.value ?? "").trim();
    expiresAt = legacyData.client_secret?.expires_at ?? null;
  }

  if (!ephemeralKey) {
    throw new Error("Realtime API nevrátilo ephemeral key.");
  }

  return {
    ephemeralKey,
    expiresAt,
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
