import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { getOpenAiApiKey } from "@/lib/ai/config";
import { OpenAiClientError } from "@/lib/ai/openai-client";

/** Whisper limit ~25 MB — bezpečný chunk pro meeting. */
export const MEETING_TRANSCRIBE_CHUNK_BYTES = 20 * 1024 * 1024;

import { getOpenAiTranscriptionModel } from "@/lib/ai/config";

async function whisperTranscribeBuffer(params: {
  audio: Buffer;
  filename: string;
  mimeType: string;
}): Promise<string> {
  const key = getOpenAiApiKey();
  if (!key) throw new OpenAiClientError(503, "OpenAI API není nakonfigurováno.");

  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audio)], {
    type: params.mimeType || "audio/webm",
  });
  form.append("file", blob, params.filename);
  form.append("model", getOpenAiTranscriptionModel());
  form.append("language", "cs");
  form.append(
    "prompt",
    "Schůzka ve stavební firmě v Česku. Jména, firmy, adresy, částky v Kč, termíny."
  );

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new OpenAiClientError(
      res.status >= 500 ? 502 : 400,
      data.error?.message || `Transcription HTTP ${res.status}`
    );
  }
  return String(data.text ?? "").trim();
}

export async function transcribeMeetingAudioFromStorage(storagePath: string): Promise<string> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není nakonfigurováno.");
  const [buf] = await bucket.file(storagePath).download();
  if (buf.length <= MEETING_TRANSCRIBE_CHUNK_BYTES) {
    return whisperTranscribeBuffer({
      audio: buf,
      filename: "meeting.webm",
      mimeType: "audio/webm",
    });
  }

  const parts: string[] = [];
  let offset = 0;
  let part = 0;
  while (offset < buf.length) {
    const slice = buf.subarray(offset, offset + MEETING_TRANSCRIBE_CHUNK_BYTES);
    offset += MEETING_TRANSCRIBE_CHUNK_BYTES;
    part += 1;
    const text = await whisperTranscribeBuffer({
      audio: Buffer.from(slice),
      filename: `meeting-part-${part}.webm`,
      mimeType: "audio/webm",
    });
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}
