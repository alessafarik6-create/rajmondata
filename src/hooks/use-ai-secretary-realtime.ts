"use client";

import { useCallback, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { voiceDebugError, voiceDebugLog } from "@/lib/ai/secretary/voice-debug";
import { mapVoiceErrorForUser } from "@/lib/ai/secretary/voice-user-errors";

export type VoiceSecretaryPhase =
  | "idle"
  | "requesting_microphone"
  | "connecting"
  | "connected"
  | "listening"
  | "assistant_speaking"
  | "processing_tool"
  | "waiting_confirmation"
  | "error"
  | "ended";

type TranscriptLine = { role: "user" | "assistant" | "system"; text: string };

type Options = {
  user: User | null | undefined;
  companyId: string;
  onError?: (message: string, detail?: { code?: string; openAiStatus?: number | null }) => void;
  onPhaseChange?: (phase: VoiceSecretaryPhase) => void;
  onTranscript?: (line: TranscriptLine) => void;
  onStatusHint?: (hint: string | null) => void;
};

async function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    };
  });
}

export function useAiSecretaryRealtime({
  user,
  companyId,
  onError,
  onPhaseChange,
  onTranscript,
  onStatusHint,
}: Options) {
  const [phase, setPhase] = useState<VoiceSecretaryPhase>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const startingRef = useRef(false);
  const activeRef = useRef(false);
  const fnCallRef = useRef<{ callId: string; name: string; args: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setPhaseSafe = useCallback(
    (p: VoiceSecretaryPhase) => {
      setPhase(p);
      onPhaseChange?.(p);
    },
    [onPhaseChange]
  );

  const cleanupMedia = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRef.current = false;
    startingRef.current = false;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const audio = audioElRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    voiceDebugLog("session closed");
  }, []);

  const stop = useCallback(async () => {
    cleanupMedia();
    setPhaseSafe("ended");
    onStatusHint?.(null);
    setTimeout(() => setPhaseSafe("idle"), 0);
  }, [cleanupMedia, setPhaseSafe, onStatusHint]);

  const sendGreeting = useCallback((dc: RTCDataChannel) => {
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions:
            "Řekni stručně a přesně česky: Dobrý den, co pro vás můžu udělat?",
        },
      })
    );
  }, []);

  const playRemoteAudio = useCallback(async () => {
    const audio = audioElRef.current;
    if (!audio) return;
    try {
      await audio.play();
    } catch {
      onError?.("Pro přehrání hlasu AI klepněte znovu na mikrofon.", { code: "autoplay_blocked" });
    }
  }, [onError]);

  const invokeTool = useCallback(
    async (toolName: string, args: Record<string, unknown>, signal: AbortSignal) => {
      if (!user) return { ok: false, error: "Nepřihlášen" };
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai/secretary/tools", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, toolName, arguments: args }),
        signal,
      });
      return res.json();
    },
    [user, companyId]
  );

  const handleRealtimeEvent = useCallback(
    (msg: Record<string, unknown>, dc: RTCDataChannel) => {
      const type = String(msg.type ?? "");

      if (type === "error") {
        const err = msg.error as { message?: string } | undefined;
        voiceDebugError("realtime error event", err?.message);
        onError?.(mapVoiceErrorForUser(err?.message), { code: "realtime_event_error" });
        return;
      }

      if (
        type === "response.output_audio_transcript.delta" ||
        type === "response.audio_transcript.delta" ||
        type === "response.audio.delta"
      ) {
        setPhaseSafe("assistant_speaking");
        onStatusHint?.("Sekretářka mluví…");
      }

      if (
        type === "response.output_audio_transcript.done" ||
        type === "response.audio_transcript.done"
      ) {
        const text = String(
          (msg as { transcript?: string }).transcript ??
            (msg as { text?: string }).text ??
            ""
        ).trim();
        if (text) {
          onTranscript?.({ role: "assistant", text });
          setPhaseSafe("listening");
          onStatusHint?.("Poslouchám…");
          voiceDebugLog("listening");
        }
      }

      if (
        type === "conversation.item.input_audio_transcription.completed" ||
        type === "input_audio_transcription.completed"
      ) {
        const text = String((msg as { transcript?: string }).transcript ?? "").trim();
        if (text) onTranscript?.({ role: "user", text: `Vy: ${text}` });
      }

      if (type === "input_audio_buffer.speech_started") {
        setPhaseSafe("listening");
        onStatusHint?.("Poslouchám…");
      }

      if (type === "response.function_call_arguments.delta") {
        const callId = String(msg.call_id ?? "");
        const name = String(msg.name ?? "");
        const delta = String(msg.delta ?? "");
        if (!fnCallRef.current || fnCallRef.current.callId !== callId) {
          fnCallRef.current = { callId, name, args: delta };
        } else {
          fnCallRef.current.args += delta;
          if (name) fnCallRef.current.name = name;
        }
        return;
      }

      const runToolFromCall = (name: string, callId: string, argsRaw: string) => {
        void (async () => {
          setPhaseSafe("processing_tool");
          onStatusHint?.("Provádím…");
          voiceDebugLog("tool proposed", { name });
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(argsRaw) as Record<string, unknown>;
          } catch {
            args = {};
          }
          const signal = abortRef.current?.signal ?? undefined;
          const result = (await invokeTool(name, args, signal ?? new AbortController().signal)) as Record<
            string,
            unknown
          >;
          if (result.pendingId || result.pendingActionId) {
            setPhaseSafe("waiting_confirmation");
            onStatusHint?.("Čekám na potvrzení…");
          }
          if (!dcRef.current || dcRef.current.readyState !== "open") return;
          dc.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify(result),
              },
            })
          );
          dc.send(JSON.stringify({ type: "response.create" }));
          setPhaseSafe("listening");
          onStatusHint?.("Poslouchám…");
          fnCallRef.current = null;
        })();
      };

      if (type === "response.function_call_arguments.done") {
        const name = String(msg.name ?? msg.function_name ?? fnCallRef.current?.name ?? "");
        const callId = String(msg.call_id ?? fnCallRef.current?.callId ?? "");
        const argsRaw = String(msg.arguments ?? fnCallRef.current?.args ?? "{}");
        runToolFromCall(name, callId, argsRaw);
        return;
      }

      if (type === "response.output_item.done") {
        const item = msg.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          const name = String(item.name ?? "");
          const callId = String(item.call_id ?? "");
          const argsRaw = String(item.arguments ?? "{}");
          runToolFromCall(name, callId, argsRaw);
        }
      }
    },
    [invokeTool, onError, onTranscript, onStatusHint, setPhaseSafe]
  );

  const attachAudioElement = useCallback((el: HTMLAudioElement | null) => {
    audioElRef.current = el;
  }, []);

  const start = useCallback(async () => {
    if (!user || !companyId || startingRef.current || activeRef.current) return;
    startingRef.current = true;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setPhaseSafe("requesting_microphone");
    onStatusHint?.("Žádám o mikrofon…");

    try {
      const token = await user.getIdToken();
      setPhaseSafe("connecting");
      onStatusHint?.("Připojuji…");

      const sessionRes = await fetch("/api/company/ai/secretary/realtime/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
        signal,
      });
      const sessionData = (await sessionRes.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        openAiStatus?: number | null;
      };
      if (!sessionData.ok) {
        onError?.(mapVoiceErrorForUser(sessionData.error), {
          code: sessionData.code,
          openAiStatus: sessionData.openAiStatus,
        });
        throw new Error(sessionData.error ?? "Session preflight failed");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (signal.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      voiceDebugLog("microphone granted", {
        track: stream.getAudioTracks()[0]?.readyState === "live",
      });

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        voiceDebugLog("remote audio received");
        const remoteStream = event.streams[0];
        if (audioElRef.current && remoteStream) {
          audioElRef.current.srcObject = remoteStream;
          void playRemoteAudio();
        }
      };

      pc.onconnectionstatechange = () => {
        voiceDebugLog("peer connection state", { state: pc.connectionState });
        if (pc.connectionState === "failed") {
          onError?.(mapVoiceErrorForUser("Spojení selhalo."), { code: "pc_failed" });
          setPhaseSafe("error");
        }
      };

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          handleRealtimeEvent(msg, dc);
        } catch {
          /* ignore */
        }
      };

      dc.onopen = () => {
        voiceDebugLog("data channel open");
        setPhaseSafe("connected");
        sendGreeting(dc);
        setPhaseSafe("assistant_speaking");
        onStatusHint?.("Sekretářka mluví…");
        voiceDebugLog("assistant speaking");
      };

      dc.onclose = () => {
        if (activeRef.current) {
          onError?.(mapVoiceErrorForUser("Spojení skončilo."), { code: "dc_closed" });
          setPhaseSafe("error");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      const localSdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
      voiceDebugLog("peer connection created");

      const sdpUrl = `/api/company/ai/secretary/realtime?companyId=${encodeURIComponent(companyId)}`;
      const sdpRes = await fetch(sdpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
        body: localSdp,
        signal,
      });

      const answerRaw = await sdpRes.text();

      if (!sdpRes.ok) {
        let errCode = "openai_sdp_exchange_failed";
        let errMsg: string | undefined;
        try {
          const errJson = JSON.parse(answerRaw) as {
            code?: string;
            message?: string;
            upstreamStatus?: number;
          };
          errCode = errJson.code ?? errCode;
          errMsg = errJson.message;
        } catch {
          /* plain text */
        }
        voiceDebugError(
          "SDP exchange failed",
          `HTTP ${sdpRes.status} ${answerRaw.slice(0, 500)}`
        );
        onError?.(mapVoiceErrorForUser(errMsg ?? answerRaw), {
          code: errCode,
          openAiStatus: sdpRes.status,
        });
        throw new Error("openai_sdp_exchange_failed");
      }

      if (!answerRaw.trim().startsWith("v=")) {
        voiceDebugError("[VOICE] SDP exchange failed", "invalid answer body");
        onError?.(mapVoiceErrorForUser("Neplatná SDP odpověď serveru."), {
          code: "invalid_sdp_answer",
        });
        throw new Error("openai_sdp_exchange_failed");
      }

      await pc.setRemoteDescription({ type: "answer", sdp: answerRaw });

      activeRef.current = true;
      startingRef.current = false;
      setPhaseSafe("listening");
      onStatusHint?.("Poslouchám…");
      voiceDebugLog("listening");
    } catch (e) {
      if (signal.aborted) return;
      startingRef.current = false;
      activeRef.current = false;
      const raw =
        e instanceof DOMException
          ? `${e.name}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "start failed";
      if (!(e instanceof Error && e.message.includes("Session preflight"))) {
        voiceDebugError("start failed", raw);
        onError?.(mapVoiceErrorForUser(raw), { code: "start_failed" });
      }
      cleanupMedia();
      setPhaseSafe("error");
      onStatusHint?.(null);
    }
  }, [
    user,
    companyId,
    sendGreeting,
    handleRealtimeEvent,
    onError,
    onStatusHint,
    playRemoteAudio,
    setPhaseSafe,
    cleanupMedia,
  ]);

  return {
    phase,
    start,
    stop,
    attachAudioElement,
    isActive: phase !== "idle" && phase !== "ended" && phase !== "error",
  };
}
