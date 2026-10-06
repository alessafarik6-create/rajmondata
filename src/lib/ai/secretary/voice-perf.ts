"use client";

/** DEV diagnostika latence hlasu — bez audio a citlivého obsahu. */

export type VoicePerfSnapshot = {
  connectionMs: number | null;
  firstAudioMs: number | null;
  userSpeechEndAt: number | null;
  toolCallStartedAt: number | null;
  toolCallFinishedAt: number | null;
  responseStartedAt: number | null;
  firstAssistantAudioAt: number | null;
  reconnectCount: number;
  connectionState: string;
  lastToolName: string | null;
  lastToolMs: number | null;
};

export function createVoicePerfTracker() {
  const t0 = performance.now();
  let sessionStart = t0;
  let connectedAt: number | null = null;
  let firstAudioAt: number | null = null;
  let userSpeechEndAt: number | null = null;
  let toolCallStartedAt: number | null = null;
  let toolCallFinishedAt: number | null = null;
  let responseStartedAt: number | null = null;
  let firstAssistantAudioAt: number | null = null;
  let reconnectCount = 0;
  let connectionState = "new";
  let lastToolName: string | null = null;
  let lastToolMs: number | null = null;

  const shouldLog =
    typeof process !== "undefined"
      ? process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_VOICE_DEBUG === "1"
      : true;

  const log = (extra?: Record<string, string | number | boolean | null>) => {
    if (!shouldLog) return;
    const snap: VoicePerfSnapshot = {
      connectionMs: connectedAt != null ? Math.round(connectedAt - sessionStart) : null,
      firstAudioMs:
        firstAudioAt != null ? Math.round(firstAudioAt - sessionStart) : null,
      userSpeechEndAt,
      toolCallStartedAt,
      toolCallFinishedAt,
      responseStartedAt,
      firstAssistantAudioAt,
      reconnectCount,
      connectionState,
      lastToolName,
      lastToolMs,
    };
    console.info("[VOICE PERF]", { ...snap, ...extra });
  };

  return {
    resetSession() {
      sessionStart = performance.now();
      connectedAt = null;
      firstAudioAt = null;
      userSpeechEndAt = null;
      toolCallStartedAt = null;
      toolCallFinishedAt = null;
      responseStartedAt = null;
      firstAssistantAudioAt = null;
      connectionState = "new";
      lastToolName = null;
      lastToolMs = null;
    },
    markReconnect() {
      reconnectCount += 1;
      log({ event: "reconnect" });
    },
    setConnectionState(state: string) {
      connectionState = state;
      if (state === "connected" && connectedAt == null) {
        connectedAt = performance.now();
        log({ event: "connected" });
      }
    },
    markFirstRemoteAudio() {
      if (firstAudioAt == null) {
        firstAudioAt = performance.now();
        log({ event: "first_audio" });
      }
      if (firstAssistantAudioAt == null) {
        firstAssistantAudioAt = performance.now();
      }
    },
    markUserSpeechEnd() {
      userSpeechEndAt = performance.now();
    },
    markResponseStarted() {
      responseStartedAt = performance.now();
    },
    markToolStart(name: string) {
      lastToolName = name;
      toolCallStartedAt = performance.now();
      log({ event: "tool_start", tool: name });
    },
    markToolEnd(ok: boolean) {
      toolCallFinishedAt = performance.now();
      if (toolCallStartedAt != null) {
        lastToolMs = Math.round(toolCallFinishedAt - toolCallStartedAt);
      }
      log({ event: "tool_end", ok, toolMs: lastToolMs });
    },
    snapshot(): VoicePerfSnapshot {
      return {
        connectionMs: connectedAt != null ? Math.round(connectedAt - sessionStart) : null,
        firstAudioMs:
          firstAudioAt != null ? Math.round(firstAudioAt - sessionStart) : null,
        userSpeechEndAt,
        toolCallStartedAt,
        toolCallFinishedAt,
        responseStartedAt,
        firstAssistantAudioAt,
        reconnectCount,
        connectionState,
        lastToolName,
        lastToolMs,
      };
    },
    log,
  };
}
