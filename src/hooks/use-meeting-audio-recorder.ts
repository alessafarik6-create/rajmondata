"use client";

import { useCallback, useRef, useState } from "react";
import type { User } from "firebase/auth";

const CHUNK_MS = 30_000;

export type MeetingRecorderPhase = "idle" | "recording" | "paused" | "uploading" | "error";

type Options = {
  user: User | null | undefined;
  companyId: string;
  recordId: string;
  userDisplayName?: string;
  onError?: (message: string) => void;
  onFinished?: () => void;
};

export function useMeetingAudioRecorder({
  user,
  companyId,
  recordId,
  userDisplayName,
  onError,
  onFinished,
}: Options) {
  const [phase, setPhase] = useState<MeetingRecorderPhase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadSessionRef = useRef<string | null>(null);
  const chunkIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const pausedAccumRef = useRef(0);
  const pauseStartedRef = useRef<number | null>(null);
  const elapsedSecRef = useRef(0);
  const recordIdRef = useRef(recordId);
  recordIdRef.current = recordId;

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const tickElapsed = useCallback(() => {
    if (startedAtRef.current == null) return;
    const pauseExtra =
      pauseStartedRef.current != null ? Date.now() - pauseStartedRef.current : 0;
    const ms = Date.now() - startedAtRef.current - pausedAccumRef.current - pauseExtra;
    const sec = Math.max(0, Math.floor(ms / 1000));
    elapsedSecRef.current = sec;
    setElapsedSec(sec);
  }, []);

  const uploadChunk = useCallback(
    async (blob: Blob) => {
      if (!user || !uploadSessionRef.current) return;
      const token = await user.getIdToken();
      const idx = chunkIndexRef.current;
      chunkIndexRef.current += 1;
      const form = new FormData();
      form.append("chunk", blob, `chunk-${idx}.webm`);
      const url =
        `/api/company/meeting-records/${encodeURIComponent(recordIdRef.current)}/audio/chunk` +
        `?companyId=${encodeURIComponent(companyId)}` +
        `&uploadSessionId=${encodeURIComponent(uploadSessionRef.current)}` +
        `&chunkIndex=${idx}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const data = await res.json();
        if (data.ok) return;
        if (attempt === 2) throw new Error(data.error ?? "Upload segmentu selhal.");
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    },
    [user, companyId]
  );

  const start = useCallback(async (recordIdOverride?: string) => {
    const activeRecordId = String(recordIdOverride ?? recordIdRef.current).trim();
    if (!user || !companyId || !activeRecordId) return;
    recordIdRef.current = activeRecordId;
    setPhase("uploading");
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(activeRecordId)}/audio/start`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ companyId, userDisplayName }),
        }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Nepodařilo se zahájit nahrávání.");

      uploadSessionRef.current = data.uploadSessionId;
      chunkIndexRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          void uploadChunk(ev.data).catch((e) => {
            onError?.(e instanceof Error ? e.message : "Upload selhal.");
            setPhase("error");
          });
        }
      };

      rec.start(CHUNK_MS);
      startedAtRef.current = Date.now();
      pausedAccumRef.current = 0;
      pauseStartedRef.current = null;
      stopTimer();
      timerRef.current = setInterval(tickElapsed, 500);
      setElapsedSec(0);
      setPhase("recording");
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Povolte prosím mikrofon v prohlížeči."
          : e instanceof Error
            ? e.message
            : "Mikrofon není dostupný.";
      onError?.(msg);
      setPhase("error");
    }
  }, [user, companyId, recordId, userDisplayName, uploadChunk, onError, tickElapsed]);

  const pause = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    pauseStartedRef.current = Date.now();
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "paused") return;
    if (pauseStartedRef.current != null) {
      pausedAccumRef.current += Date.now() - pauseStartedRef.current;
      pauseStartedRef.current = null;
    }
    rec.resume();
    setPhase("recording");
  }, []);

  const stop = useCallback(async () => {
    if (!user || !uploadSessionRef.current) return;
    setPhase("uploading");
    stopTimer();
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/meeting-records/${encodeURIComponent(recordIdRef.current)}/audio/finish`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId,
            uploadSessionId: uploadSessionRef.current,
            durationSeconds: elapsedSecRef.current,
          }),
        }
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Uložení nahrávky selhalo.");
      setPhase("idle");
      onFinished?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Uložení selhalo.");
      setPhase("error");
    }
  }, [user, companyId, onError, onFinished]);

  const isActive = phase === "recording" || phase === "paused" || phase === "uploading";

  const formatElapsed = () => {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return { phase, elapsedSec, formatElapsed, start, pause, resume, stop, isActive };
}
