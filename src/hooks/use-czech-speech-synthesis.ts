"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechSynthState = "idle" | "speaking" | "paused" | "unsupported" | "error";

function pickCzechVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const cs = voices.filter((v) => v.lang.toLowerCase().startsWith("cs"));
  const female = cs.find((v) => /female|zuzana|iveta|google.*cs/i.test(v.name));
  return female ?? cs[0] ?? voices.find((v) => v.lang.startsWith("cs")) ?? null;
}

export function useCzechSpeechSynthesis(options?: {
  onEnd?: () => void;
  onError?: (message: string) => void;
}) {
  const onEndRef = useRef(options?.onEnd);
  const onErrorRef = useRef(options?.onError);
  onEndRef.current = options?.onEnd;
  onErrorRef.current = options?.onError;
  const [state, setState] = useState<SpeechSynthState>(() =>
    typeof window !== "undefined" && window.speechSynthesis ? "idle" : "unsupported"
  );
  const [volume, setVolume] = useState(1);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setState("unsupported");
      return;
    }
    const load = () => {
      voiceRef.current = pickCzechVoice();
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    utterRef.current = null;
    setState("idle");
  }, []);

  useEffect(() => {
    return () => cancel();
  }, [cancel]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cancel]);

  const speak = useCallback(
    (text: string, muted: boolean) => {
      cancel();
      if (muted) {
        onEndRef.current?.();
        return;
      }
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setState("unsupported");
        onErrorRef.current?.("Váš prohlížeč nepodporuje hlasový výklad. Použijte textové titulky.");
        onEndRef.current?.();
        return;
      }
      const t = String(text ?? "").trim();
      if (!t) {
        onEndRef.current?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(t);
      u.lang = "cs-CZ";
      u.rate = 0.95;
      u.pitch = 1.05;
      u.volume = Math.min(1, Math.max(0, volume));
      const v = voiceRef.current ?? pickCzechVoice();
      if (v) u.voice = v;
      u.onend = () => {
        utterRef.current = null;
        setState("idle");
        onEndRef.current?.();
      };
      u.onerror = (ev) => {
        utterRef.current = null;
        const code = (ev as SpeechSynthesisErrorEvent).error ?? "unknown";
        if (code === "canceled" || code === "interrupted") {
          setState("idle");
          return;
        }
        setState("error");
        onErrorRef.current?.("Zvuk se nepodařilo načíst. Zkusit znovu.");
        onEndRef.current?.();
      };
      utterRef.current = u;
      setState("speaking");
      window.speechSynthesis.speak(u);
    },
    [cancel, volume]
  );

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.pause();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.resume();
    setState("speaking");
  }, []);

  return {
    state,
    volume,
    setVolume,
    speak,
    cancel,
    pause,
    resume,
    supported: state !== "unsupported",
  };
}
