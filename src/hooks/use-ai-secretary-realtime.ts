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
  onError?: (message: string) => void;
  onPhaseChange?: (phase: VoiceSecretaryPhase) => void;
  onTranscript?: (line: TranscriptLine) => void;
  onStatusHint?: (hint: string | null) => void;
};

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

  const setPhaseSafe = useCallback(
    (p: VoiceSecretaryPhase) => {
      setPhase(p);
      onPhaseChange?.(p);
    },
    [onPhaseChange]
  );

  const cleanupMedia = useCallback(() => {
    activeRef.current = false;
    startingRef.current = false;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
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

  const invokeTool = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      if (!user) return { ok: false, error: "Nepřihlášen" };
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai/secretary/tools", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, toolName, arguments: args }),
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
        onError?.(mapVoiceErrorForUser(err?.message));
        return;
      }

      if (
        type === "response.output_audio_transcript.delta" ||
        type === "response.audio_transcript.delta"
      ) {
        setPhaseSafe("assistant_speaking");
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
          onStatusHint?.("Přemýšlím…");
          voiceDebugLog("tool proposed", { name });
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(argsRaw) as Record<string, unknown>;
          } catch {
            args = {};
          }
          const result = (await invokeTool(name, args)) as Record<string, unknown>;
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
    setPhaseSafe("requesting_microphone");
    onStatusHint?.("Žádám o mikrofon…");

    try {
      const token = await user.getIdToken();
      setPhaseSafe("connecting");
      onStatusHint?.("Připojuji hlasovou AI…");

      const sessionRes = await fetch("/api/company/ai/secretary/realtime/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionData.ok) {
        throw new Error(
          mapVoiceErrorForUser(String(sessionData.error ?? "Nepodařilo se vytvořit realtime session."))
        );
      }

      const ephemeralKey = String(sessionData.clientSecret ?? sessionData.ephemeralKey ?? "");
      if (!ephemeralKey) throw new Error("Chybí ephemeral token pro realtime.");

      voiceDebugLog("session created", { session: true });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      voiceDebugLog("microphone permission", {
        granted: true,
        track: audioTrack?.readyState === "live",
      });

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        voiceDebugLog("remote track received", { remote: true });
        const remoteStream = event.streams[0];
        if (audioElRef.current && remoteStream) {
          audioElRef.current.srcObject = remoteStream;
          void audioElRef.current.play().catch(() => {
            onError?.("Pro přehrání hlasu AI klikněte znovu na oblast hlasu.");
          });
        }
      };

      pc.onconnectionstatechange = () => {
        voiceDebugLog("peer connection state", { state: pc.connectionState });
        if (pc.connectionState === "failed") {
          onError?.(mapVoiceErrorForUser("Spojení s hlasovou AI selhalo."));
          setPhaseSafe("error");
        }
      };

      pc.addTrack(audioTrack, stream);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        voiceDebugLog("data channel", { open: true });
        setPhaseSafe("connected");
        sendGreeting(dc);
        setPhaseSafe("assistant_speaking");
        onStatusHint?.("RAJMONDATA AI mluví…");
        setTimeout(() => {
          if (activeRef.current) {
            setPhaseSafe("listening");
            onStatusHint?.("Poslouchám…");
          }
        }, 4000);
      };

      dc.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          handleRealtimeEvent(msg, dc);
        } catch {
          /* ignore */
        }
      };

      dc.onclose = () => {
        voiceDebugLog("data channel closed");
        if (activeRef.current) {
          onError?.(mapVoiceErrorForUser("Realtime session skončila."));
          setPhaseSafe("error");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      voiceDebugLog("peer connection created", { pc: true });

      const sdpRes = await fetch("/api/company/ai/secretary/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sdp: offer.sdp, ephemeralKey }),
      });

      const sdpData = (await sdpRes.json().catch(() => ({}))) as {
        ok?: boolean;
        sdp?: string;
        error?: string;
      };

      if (!sdpRes.ok || !sdpData.ok || !sdpData.sdp) {
        voiceDebugError("SDP exchange failed", sdpData.error ?? `HTTP ${sdpRes.status}`);
        throw new Error(sdpData.error ?? "Nepodařilo se připojit hlasovou AI.");
      }

      await pc.setRemoteDescription({ type: "answer", sdp: sdpData.sdp });

      activeRef.current = true;
      startingRef.current = false;
      setPhaseSafe("listening");
      onStatusHint?.("Poslouchám…");
    } catch (e) {
      startingRef.current = false;
      activeRef.current = false;
      const raw =
        e instanceof DOMException
          ? `${e.name}: ${e.message}`
          : e instanceof Error
            ? e.message
            : "start failed";
      voiceDebugError("start failed", raw);
      onError?.(mapVoiceErrorForUser(raw));
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
    onTranscript,
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
