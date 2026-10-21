"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { productTourAudioUrl, type ProductTourAudioManifest } from "@/lib/ai-tutor/product-demo-audio";

export type NarrationEngine = "none" | "mp3" | "speech" | "captions";
export type NarrationPlayState = "idle" | "loading" | "playing" | "paused";

export type NarrationUserMessage =
  | null
  | { tone: "info" | "warn"; text: string };

export type NarrationDiagnostics = {
  lastErrorCode: string | null;
  lastEngine: NarrationEngine;
  needsGesture: boolean;
};

function pickCzechVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const cs = voices.filter((v) => v.lang.toLowerCase().startsWith("cs"));
  const female = cs.find((v) => /female|vlasta|zuzana|iveta|google.*cs/i.test(v.name));
  return female ?? cs[0] ?? voices.find((v) => v.lang.startsWith("cs")) ?? null;
}

function waitForVoices(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve(false);
      return;
    }
    if (pickCzechVoice()) {
      resolve(true);
      return;
    }
    const t = window.setTimeout(() => resolve(Boolean(pickCzechVoice())), timeoutMs);
    const onChange = () => {
      if (pickCzechVoice()) {
        window.speechSynthesis.removeEventListener("voiceschanged", onChange);
        window.clearTimeout(t);
        resolve(true);
      }
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
  });
}

type PlayOpts = {
  stepId: string;
  narration: string;
  muted: boolean;
  durationSec: number;
  volume: number;
  onEnded: () => void;
  onDiagnostic?: (code: string, engine: NarrationEngine) => void;
};

export function useProductTourNarration() {
  const [playState, setPlayState] = useState<NarrationPlayState>("idle");
  const [engine, setEngine] = useState<NarrationEngine>("none");
  const [userMessage, setUserMessage] = useState<NarrationUserMessage>(null);
  const [volume, setVolume] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const intentionalStopRef = useRef(false);
  const unlockedRef = useRef(false);
  const manifestRef = useRef<Set<string> | null>(null);
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const currentStepIdRef = useRef<string | null>(null);
  const onEndedRef = useRef<(() => void) | null>(null);
  const diagRef = useRef<NarrationDiagnostics>({
    lastErrorCode: null,
    lastEngine: "none",
    needsGesture: false,
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopSpeech = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    intentionalStopRef.current = true;
    window.speechSynthesis.cancel();
    window.setTimeout(() => {
      intentionalStopRef.current = false;
    }, 50);
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      intentionalStopRef.current = true;
      a.pause();
      a.currentTime = 0;
      a.onended = null;
      a.onerror = null;
      audioRef.current = null;
      window.setTimeout(() => {
        intentionalStopRef.current = false;
      }, 50);
    }
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    stopAudio();
    stopSpeech();
    setPlayState("idle");
    setEngine("none");
  }, [clearTimer, stopAudio, stopSpeech]);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && playState === "playing") {
        stopAudio();
        stopSpeech();
        setPlayState("paused");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [playState, stopAudio, stopSpeech]);

  const loadManifest = useCallback(async (): Promise<Set<string>> => {
    if (manifestRef.current) return manifestRef.current;
    try {
      const res = await fetch("/api/public/product-tour/audio/manifest", { cache: "force-cache" });
      if (!res.ok) throw new Error("manifest_http");
      const json = (await res.json()) as ProductTourAudioManifest;
      manifestRef.current = new Set(json.steps ?? []);
    } catch {
      manifestRef.current = new Set();
    }
    return manifestRef.current;
  }, []);

  const preloadSteps = useCallback(
    async (stepIds: string[]) => {
      const manifest = await loadManifest();
      for (const id of stepIds) {
        if (!manifest.has(id) || audioPoolRef.current.has(id)) continue;
        const a = new Audio(productTourAudioUrl(id));
        a.preload = "auto";
        a.load();
        audioPoolRef.current.set(id, a);
      }
    },
    [loadManifest]
  );

  const unlockAudio = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    unlockedRef.current = false;
    diagRef.current.needsGesture = false;

    const manifest = await loadManifest();
    const probeId = manifest.has("intro") ? "intro" : [...manifest][0];
    if (probeId) {
      try {
        const a = audioPoolRef.current.get(probeId) ?? new Audio(productTourAudioUrl(probeId));
        a.volume = 0.001;
        a.preload = "auto";
        await a.play();
        a.pause();
        a.currentTime = 0;
        a.volume = 1;
        audioPoolRef.current.set(probeId, a);
        unlockedRef.current = true;
        return true;
      } catch (e) {
        const name = e instanceof Error ? e.name : "play_rejected";
        diagRef.current.lastErrorCode = name;
        if (name === "NotAllowedError") {
          diagRef.current.needsGesture = true;
          setUserMessage({
            tone: "info",
            text: "Prohlížeč čeká na potvrzení přehrávání zvuku. Klepněte na „Pokračovat se zvukem“.",
          });
        }
      }
    }

    if (window.speechSynthesis) {
      await waitForVoices(800);
      unlockedRef.current = true;
      return true;
    }

    return false;
  }, [loadManifest]);

  const scheduleCaptionsAdvance = useCallback(
    (durationSec: number, onEnded: () => void) => {
      clearTimer();
      timerRef.current = window.setTimeout(onEnded, Math.max(3, durationSec) * 1000);
      setEngine("captions");
      setPlayState("playing");
      setUserMessage({
        tone: "info",
        text: "Hlasový výklad není momentálně dostupný. Prohlídka pokračuje s titulky.",
      });
    },
    [clearTimer]
  );

  const speakWeb = useCallback(
    async (text: string, vol: number, onEnded: () => void, onDiagnostic?: PlayOpts["onDiagnostic"]) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        onDiagnostic?.("speech_unsupported", "speech");
        scheduleCaptionsAdvance(8, onEnded);
        return false;
      }
      const okVoices = await waitForVoices(1200);
      if (!okVoices && !pickCzechVoice()) {
        onDiagnostic?.("speech_no_czech_voice", "speech");
        scheduleCaptionsAdvance(8, onEnded);
        return false;
      }

      stopSpeech();
      await new Promise((r) => window.setTimeout(r, 80));
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "cs-CZ";
      u.rate = 0.95;
      u.pitch = 1.02;
      u.volume = Math.min(1, Math.max(0, vol));
      const v = pickCzechVoice();
      if (v) u.voice = v;

      u.onend = () => {
        setPlayState("idle");
        setEngine("none");
        onEnded();
      };
      u.onerror = (ev) => {
        const code = (ev as SpeechSynthesisErrorEvent).error ?? "speech_error";
        if (intentionalStopRef.current || code === "canceled" || code === "interrupted") {
          return;
        }
        onDiagnostic?.(String(code), "speech");
        setUserMessage({ tone: "warn", text: "Zvuk se nepodařilo načíst. Zkusit znovu — tlačítko Zopakovat hlas." });
        scheduleCaptionsAdvance(8, onEnded);
      };

      setEngine("speech");
      setPlayState("playing");
      setUserMessage(null);
      window.speechSynthesis.speak(u);
      return true;
    },
    [scheduleCaptionsAdvance, stopSpeech]
  );

  const playMp3 = useCallback(
    async (
      stepId: string,
      vol: number,
      onEnded: () => void,
      onDiagnostic?: PlayOpts["onDiagnostic"]
    ): Promise<boolean> => {
      stopAudio();
      let pooled = audioPoolRef.current.get(stepId);
      if (!pooled) {
        pooled = new Audio(productTourAudioUrl(stepId));
        pooled.preload = "auto";
        audioPoolRef.current.set(stepId, pooled);
      }
      const a = new Audio(productTourAudioUrl(stepId));
      a.volume = Math.min(1, Math.max(0, vol));
      audioRef.current = a;

      const loaded = await new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => {
          a.removeEventListener("canplaythrough", onOk);
          a.removeEventListener("error", onFail);
          resolve(ok);
        };
        const onOk = () => done(true);
        const onFail = () => done(false);
        a.addEventListener("canplaythrough", onOk, { once: true });
        a.addEventListener("error", onFail, { once: true });
        a.load();
        window.setTimeout(() => done(false), 12_000);
      });

      if (!loaded) {
        onDiagnostic?.("audio_load_failed", "mp3");
        stopAudio();
        return false;
      }

      return new Promise<boolean>((resolve) => {
        a.onended = () => {
          if (intentionalStopRef.current) return;
          audioRef.current = null;
          setPlayState("idle");
          setEngine("none");
          onEnded();
        };
        a.onerror = () => {
          if (intentionalStopRef.current) return;
          onDiagnostic?.("audio_element_error", "mp3");
          stopAudio();
          resolve(false);
        };
        setEngine("mp3");
        setPlayState("playing");
        setUserMessage(null);
        a.play()
          .then(() => resolve(true))
          .catch((e: unknown) => {
            const code = e instanceof Error ? e.name : "mp3_play_rejected";
            onDiagnostic?.(code, "mp3");
            stopAudio();
            resolve(false);
          });
      });
    },
    [stopAudio]
  );

  const playStep = useCallback(
    async (opts: PlayOpts) => {
      const { stepId, narration, muted, durationSec, volume: vol, onEnded, onDiagnostic } = opts;
      currentStepIdRef.current = stepId;
      onEndedRef.current = onEnded;
      clearTimer();
      stop();

      if (muted) {
        scheduleCaptionsAdvance(durationSec, onEnded);
        return;
      }

      setPlayState("loading");
      setUserMessage(null);
      diagRef.current.lastEngine = "none";

      const manifest = await loadManifest();
      if (manifest.has(stepId)) {
        const ok = await playMp3(stepId, vol, onEnded, onDiagnostic);
        if (ok) {
          diagRef.current.lastEngine = "mp3";
          return;
        }
        setUserMessage({ tone: "warn", text: "Zvuk se nepodařilo načíst. Zkusit znovu nebo pokračovat s titulky." });
      }

      const spoke = await speakWeb(narration, vol, onEnded, onDiagnostic);
      if (spoke) {
        diagRef.current.lastEngine = "speech";
        return;
      }
      diagRef.current.lastEngine = "captions";
    },
    [clearTimer, stop, scheduleCaptionsAdvance, loadManifest, playMp3, speakWeb]
  );

  const pause = useCallback(() => {
    clearTimer();
    const a = audioRef.current;
    if (a && !a.paused) {
      a.pause();
      setPlayState("paused");
      return;
    }
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
      setPlayState("paused");
    }
  }, [clearTimer]);

  const resume = useCallback(() => {
    const a = audioRef.current;
    if (a && a.paused) {
      void a.play();
      setPlayState("playing");
      return;
    }
    if (typeof window !== "undefined" && window.speechSynthesis?.paused) {
      window.speechSynthesis.resume();
      setPlayState("playing");
    }
  }, []);

  const repeatCurrent = useCallback(
    (opts: Omit<PlayOpts, "stepId" | "narration"> & { stepId: string; narration: string }) => {
      void playStep(opts);
    },
    [playStep]
  );

  return {
    playState,
    engine,
    userMessage,
    volume,
    setVolume,
    unlockAudio,
    preloadSteps,
    playStep,
    pause,
    resume,
    stop,
    repeatCurrent,
    getDiagnostics: () => diagRef.current,
    isUnlocked: () => unlockedRef.current,
  };
}
