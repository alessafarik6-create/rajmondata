"use client";

import { useCallback, useRef, useState } from "react";
import type { User } from "firebase/auth";

export type VoiceSecretaryPhase = "idle" | "connecting" | "listening" | "error";

type Options = {
  user: User | null | undefined;
  companyId: string;
  onError?: (message: string) => void;
  onTranscriptLine?: (line: string) => void;
};

export function useAiSecretaryRealtime({ user, companyId, onError, onTranscriptLine }: Options) {
  const [phase, setPhase] = useState<VoiceSecretaryPhase>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const stop = useCallback(async () => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (user && companyId) {
      try {
        const token = await user.getIdToken();
        await fetch("/api/company/ai/secretary/realtime/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, action: "end" }),
        }).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    setPhase("idle");
  }, [user, companyId]);

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

  const start = useCallback(async () => {
    if (!user || !companyId) return;
    setPhase("connecting");
    try {
      const token = await user.getIdToken();
      const sessionRes = await fetch("/api/company/ai/secretary/realtime/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionData.ok) throw new Error(sessionData.error ?? "Session selhala.");

      const ephemeralKey = sessionData.clientSecret as string;
      const model = sessionData.model as string;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTrack(stream.getTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          const type = String(msg.type ?? "");
          if (type.includes("transcript") || type === "response.audio_transcript.done") {
            const text = String((msg as { transcript?: string }).transcript ?? "").trim();
            if (text) onTranscriptLine?.(text);
          }
          if (type === "response.function_call_arguments.done") {
            const name = String(msg.name ?? "");
            const callId = String(msg.call_id ?? "");
            const argsRaw = String(msg.arguments ?? "{}");
            void (async () => {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(argsRaw) as Record<string, unknown>;
              } catch {
                args = {};
              }
              const result = await invokeTool(name, args);
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
            })();
          }
        } catch {
          /* ignore parse */
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );
      if (!sdpRes.ok) {
        throw new Error(`Realtime SDP HTTP ${sdpRes.status}`);
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setPhase("listening");
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Povolte mikrofon pro hlasovou sekretářku."
          : e instanceof Error
            ? e.message
            : "Voice session selhala.";
      onError?.(msg);
      setPhase("error");
      await stop();
    }
  }, [user, companyId, invokeTool, onError, onTranscriptLine, stop]);

  return { phase, start, stop };
}
