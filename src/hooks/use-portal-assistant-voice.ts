"use client";

import { useCallback, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { PORTAL_ASSISTANT_MAX_RECORDING_MS } from "@/lib/ai/openai-whisper-transcribe";

export type VoiceInputState = "idle" | "recording" | "processing" | "error";

type Options = {
  user: User | null | undefined;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
};

function getSpeechRecognitionCtor(): (new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results?: { [i: number]: { [j: number]: { transcript?: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => unknown;
    webkitSpeechRecognition?: new () => unknown;
  };
  const C = w.SpeechRecognition || w.webkitSpeechRecognition;
  return (C as ReturnType<typeof getSpeechRecognitionCtor>) ?? null;
}

function tryWebSpeechTranscript(): Promise<string | null> {
  const SR = getSpeechRecognitionCtor();
  if (!SR) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const rec = new SR();
      rec.lang = "cs-CZ";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      let done = false;
      const finish = (text: string | null) => {
        if (done) return;
        done = true;
        resolve(text);
      };
      rec.onresult = (ev: { results?: { [i: number]: { [j: number]: { transcript?: string } } } }) => {
        const t = ev.results?.[0]?.[0]?.transcript;
        finish(typeof t === "string" ? t.trim() : null);
      };
      rec.onerror = () => finish(null);
      rec.onend = () => finish(null);
      rec.start();
      setTimeout(() => {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }, PORTAL_ASSISTANT_MAX_RECORDING_MS);
    } catch {
      resolve(null);
    }
  });
}

export function usePortalAssistantVoice({ user, onTranscript, onError }: Options) {
  const [state, setState] = useState<VoiceInputState>("idle");
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
  }, []);

  const uploadAndTranscribe = useCallback(
    async (blob: Blob) => {
      if (!user) {
        onError?.("Pro hlasový vstup se přihlaste.");
        setState("error");
        return;
      }
      setState("processing");
      setStatusHint("Přepisuji…");
      try {
        const token = await user.getIdToken();
        const fd = new FormData();
        fd.append("audio", blob, "voice.webm");
        const res = await fetch("/api/company/portal-assistant/transcribe", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
        if (res.ok && data.ok && data.text) {
          onTranscript(data.text);
          setState("idle");
          setStatusHint(null);
          return;
        }
        throw new Error(data.error || "Přepis selhal.");
      } catch (e) {
        const msg =
          (e as Error)?.message?.includes("Permission") ||
          (e as Error)?.message?.includes("NotAllowed")
            ? "Povolte mikrofon v prohlížeči, nebo napište dotaz ručně."
            : "Nepodařilo se rozpoznat řeč.";
        onError?.(msg);
        setStatusHint(msg);
        setState("error");
        setTimeout(() => {
          setState("idle");
          setStatusHint(null);
        }, 4000);
      }
    },
    [user, onTranscript, onError]
  );

  const startRecording = useCallback(async () => {
    if (state === "recording" || state === "processing") return;
    setStatusHint(null);
    setState("recording");
    setStatusHint("Poslouchám…");
    chunksRef.current = [];

    try {
      if (typeof MediaRecorder === "undefined") {
        setState("processing");
        setStatusHint("Poslouchám…");
        const text = await tryWebSpeechTranscript();
        if (text) {
          onTranscript(text);
          setState("idle");
          setStatusHint(null);
          return;
        }
        throw new Error("Speech API unavailable");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) {
          setState("idle");
          setStatusHint(null);
          return;
        }
        void uploadAndTranscribe(blob);
      };

      recorder.start();
      stopTimerRef.current = setTimeout(() => stopRecording(), PORTAL_ASSISTANT_MAX_RECORDING_MS);
    } catch {
      onError?.("Povolte mikrofon v prohlížeči, nebo napište dotaz ručně.");
      setStatusHint("Povolte mikrofon v prohlížeči, nebo napište dotaz ručně.");
      setState("error");
      setTimeout(() => {
        setState("idle");
        setStatusHint(null);
      }, 4000);
    }
  }, [state, stopRecording, uploadAndTranscribe, onError]);

  const toggleMic = useCallback(() => {
    if (state === "recording") {
      stopRecording();
      return;
    }
    if (state === "idle" || state === "error") {
      void startRecording();
    }
  }, [state, startRecording, stopRecording]);

  return {
    voiceState: state,
    voiceStatusHint: statusHint,
    toggleMic,
    stopRecording,
  };
}
