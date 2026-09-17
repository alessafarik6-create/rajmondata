import { getOpenAiApiKey } from "@/lib/ai/config";
import { OpenAiClientError } from "@/lib/ai/openai-client";

/** Max velikost audio souboru pro nápovědu portálu (~60–90 s webm). */
export const PORTAL_ASSISTANT_MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const PORTAL_ASSISTANT_MAX_RECORDING_MS = 120_000;

export async function transcribeAudioWithOpenAiWhisper(params: {
  audio: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
}): Promise<string> {
  const key = getOpenAiApiKey();
  if (!key) {
    throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");
  }
  if (params.audio.length === 0) {
    throw new OpenAiClientError(400, "Prázdné audio.");
  }
  if (params.audio.length > PORTAL_ASSISTANT_MAX_AUDIO_BYTES) {
    throw new OpenAiClientError(400, "Nahrávka je příliš dlouhá nebo velká.");
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audio)], {
    type: params.mimeType || "audio/webm",
  });
  form.append("file", blob, params.filename || "voice.webm");
  form.append("model", "whisper-1");
  if (params.language) {
    form.append("language", params.language);
  }

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: form,
  });

  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!res.ok) {
    const msg = data.error?.message || `Whisper HTTP ${res.status}`;
    throw new OpenAiClientError(res.status >= 500 ? 502 : 400, msg);
  }
  const text = String(data.text ?? "").trim();
  if (!text) {
    throw new OpenAiClientError(422, "Nepodařilo se rozpoznat řeč.");
  }
  return text;
}
