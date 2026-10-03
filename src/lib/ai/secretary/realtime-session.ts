import { getOpenAiApiKey, getOpenAiRealtimeModel } from "@/lib/ai/config";
import { secretarySystemInstructions, type SecretaryContext } from "@/lib/ai/secretary/context";
import { secretaryRealtimeToolDefinitions } from "@/lib/ai/secretary/tools/run-tool";

export async function createOpenAiRealtimeSession(ctx: SecretaryContext): Promise<{
  clientSecret: string;
  expiresAt: number | null;
  model: string;
}> {
  const key = getOpenAiApiKey();
  if (!key) throw new Error("OpenAI API není nakonfigurováno.");

  const model = getOpenAiRealtimeModel();
  const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice: String(process.env.OPENAI_REALTIME_VOICE ?? "alloy").trim() || "alloy",
      modalities: ["audio", "text"],
      instructions: secretarySystemInstructions(ctx),
      tools: secretaryRealtimeToolDefinitions(),
      turn_detection: { type: "server_vad", interrupt_response: true },
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    client_secret?: { value?: string; expires_at?: number };
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message || `Realtime session HTTP ${res.status}`);
  }
  const secret = String(data.client_secret?.value ?? "").trim();
  if (!secret) throw new Error("Realtime session nevrátila client_secret.");
  return {
    clientSecret: secret,
    expiresAt: data.client_secret?.expires_at ?? null,
    model,
  };
}
