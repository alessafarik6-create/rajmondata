/** Sledování EZUIKit událostí a odhad toku dat (bez citlivých URL/tokenů). */

import { hikLiveLog } from "@/lib/hikvision/player-runtime-diagnostics";

export type HikStreamTelemetry = {
  receivedBytes: number;
  dataEvents: number;
  videoPackets: number;
  decodedFrames: number;
  renderedFrames: number;
  websocketOpen: boolean;
  lastEvent: string | null;
  playAcknowledged: boolean;
  decoderReady: boolean;
};

export function createHikStreamTelemetry(): HikStreamTelemetry {
  return {
    receivedBytes: 0,
    dataEvents: 0,
    videoPackets: 0,
    decodedFrames: 0,
    renderedFrames: 0,
    websocketOpen: false,
    lastEvent: null,
    playAcknowledged: false,
    decoderReady: false,
  };
}

function estimatePayloadBytes(info: unknown): number {
  if (info == null) return 0;
  if (info instanceof ArrayBuffer) return info.byteLength;
  if (info instanceof Uint8Array) return info.byteLength;
  if (typeof info === "object") {
    const o = info as Record<string, unknown>;
    if (o.data instanceof ArrayBuffer) return o.data.byteLength;
    if (o.data instanceof Uint8Array) return o.data.byteLength;
    if (typeof o.size === "number" && o.size > 0) return o.size;
    if (typeof o.length === "number" && o.length > 0) return o.length;
  }
  return 0;
}

const TELEMETRY_EVENTS = [
  "play",
  "pause",
  "stop",
  "error",
  "decodeStart",
  "decode",
  "decoding",
  "firstFrame",
  "firstframe",
  "singleFrame",
  "streamSuccess",
  "streamStart",
  "streaming-start",
  "connected",
  "CONNECTED",
  "data",
  "DATA",
  "openStream",
  "startPlay",
  "transmission",
  "videoInfo",
  "loadedMetaData",
  "load",
] as const;

export function attachHikPlayerTelemetry(
  player: { on?: (event: string, cb: (info?: unknown) => void) => void },
  telemetry: HikStreamTelemetry,
  onFrameEvent?: (eventName: string) => void
): () => void {
  const handlers: Array<{ event: string; fn: (info?: unknown) => void }> = [];

  const bind = (event: string, fn: (info?: unknown) => void) => {
    if (typeof player.on !== "function") return;
    try {
      player.on(event, fn);
      handlers.push({ event, fn });
    } catch {
      /* ignore unsupported event */
    }
  };

  for (const event of TELEMETRY_EVENTS) {
    bind(event, (info) => {
      telemetry.lastEvent = event;
      const lower = event.toLowerCase();

      if (lower === "play") {
        telemetry.playAcknowledged = true;
        hikLiveLog("play result", sanitizeTelemetryInfo(info));
      } else if (lower.includes("connect") || lower === "connected") {
        telemetry.websocketOpen = true;
        hikLiveLog("websocket open");
      } else if (lower === "data" || event === "DATA") {
        const n = estimatePayloadBytes(info);
        telemetry.dataEvents += 1;
        telemetry.receivedBytes += n > 0 ? n : 1;
        if (telemetry.dataEvents === 1) hikLiveLog("first packet");
      } else if (
        lower.includes("decode") &&
        (lower.includes("start") || lower === "decoding" || lower === "decode")
      ) {
        telemetry.decoderReady = true;
        hikLiveLog("decoder ready");
      } else if (
        lower === "firstframe" ||
        lower === "singleframe" ||
        lower === "singleframe"
      ) {
        telemetry.decodedFrames += 1;
        telemetry.videoPackets += 1;
        if (telemetry.decodedFrames === 1) {
          hikLiveLog("first video packet");
          hikLiveLog("first frame");
        }
        onFrameEvent?.(event);
      } else if (lower.includes("stream") && lower.includes("success")) {
        hikLiveLog("stream connected");
      } else if (lower === "error") {
        hikLiveLog("error", sanitizeTelemetryInfo(info));
      }

      if (lower === "transmission" || lower === "startplay") {
        const n = estimatePayloadBytes(info);
        if (n > 0) {
          telemetry.receivedBytes += n;
          telemetry.videoPackets += 1;
        }
      }
    });
  }

  return () => {
    for (const { event, fn } of handlers) {
      try {
        (player as { off?: (event: string, fn: (info?: unknown) => void) => void }).off?.(
          event,
          fn
        );
      } catch {
        /* ignore */
      }
    }
  };
}

function sanitizeTelemetryInfo(info: unknown): Record<string, string | number | boolean> {
  if (info == null) return { empty: true };
  if (typeof info === "boolean") return { ok: info };
  if (typeof info === "number") return { value: info };
  if (typeof info === "string") return { message: info.slice(0, 120) };
  if (typeof info === "object") {
    const o = info as Record<string, unknown>;
    const out: Record<string, string | number | boolean> = {};
    for (const k of ["type", "retcode", "code", "msg", "width", "height", "codec"]) {
      if (o[k] != null) out[k] = String(o[k]).slice(0, 80);
    }
    return Object.keys(out).length ? out : { keys: Object.keys(o).slice(0, 8).join(",") };
  }
  return { value: String(info).slice(0, 80) };
}

export function syncTelemetryToDiagnostics(
  telemetry: HikStreamTelemetry,
  set: (patch: Partial<HikStreamTelemetry>) => void
): void {
  set({
    receivedBytes: telemetry.receivedBytes,
    dataEvents: telemetry.dataEvents,
    videoPackets: telemetry.videoPackets,
    decodedFrames: telemetry.decodedFrames,
    renderedFrames: telemetry.renderedFrames,
    websocketOpen: telemetry.websocketOpen,
    playAcknowledged: telemetry.playAcknowledged,
    decoderReady: telemetry.decoderReady,
  });
}
