/** Bezpečná runtime diagnostika Hikvision live playeru (admin / dev). */

import type { StreamCodecHint } from "@/lib/hikvision/ezopen-stream-meta";

export type HikvisionLivePipelineStage =
  | "IDLE"
  | "CONFIG_LOADING"
  | "CONFIG_READY"
  | "SDK_LOADING"
  | "SDK_READY"
  | "CONFIG_OK"
  | "PLAYER_CREATING"
  | "PLAYER_CREATED"
  | "PLAY_REQUESTED"
  | "PLAY_SUCCESS"
  | "STREAM_CONNECTED"
  | "DECODER_STARTED"
  | "FIRST_FRAME"
  | "PLAYING"
  | "FAILED";

export type HikvisionPlayerFailureCode =
  | "STREAM_URL_FAILED"
  | "STREAM_CONNECTED_NO_DATA"
  | "UNSUPPORTED_CODEC"
  | "DECODER_FAILED"
  | "NO_FIRST_FRAME"
  | "PLAYER_RENDER_FAILED"
  | "PLAY_FAILED"
  | "DEVICE_OFFLINE"
  | string;

export type HikvisionPlayerRuntimePhase =
  | "IDLE"
  | "SDK_LOADING"
  | "SDK_LOADED"
  | "STREAM_CONFIG_LOADED"
  | "PLAYER_CREATING"
  | "PLAYER_CREATED"
  | "PLAY_STARTED"
  | "PLAY_ERROR"
  | "PLAYER_DESTROYED";

let phase: HikvisionPlayerRuntimePhase = "IDLE";
let pipelineStage: HikvisionLivePipelineStage = "IDLE";
let lastErrorCode: HikvisionPlayerFailureCode | null = null;
let lastScriptUrl: string | null = null;
let streamUrlPresent = false;
let tokenPresent = false;
let expiresAt: string | null = null;

let cameraId: string | null = null;
let deviceSerialMasked: string | null = null;
let channelNo: string | null = null;
let streamType: string | null = null;
let streamVariant: "main" | "sub" | null = null;
let protocol: string | null = null;
let codecHint: StreamCodecHint = "unknown";

let playerCreated = false;
let streamConnected = false;
let decoderStarted = false;
let firstFrameReceived = false;
let videoRendered = false;

let sdkLoadCount = 0;
let liveConfigFetchCount = 0;
let playerCreateCount = 0;
let playerDestroyCount = 0;
let playStartCount = 0;
let playRequestCount = 0;
let streamConnectCount = 0;
let decoderStartCount = 0;
let firstFrameCount = 0;

let domVideoWidth = 0;
let domVideoHeight = 0;
let domCanvasWidth = 0;
let domCanvasHeight = 0;
let domHasVideo = false;
let domHasCanvas = false;

export function resetHikvisionPlayerDebugCounters(): void {
  sdkLoadCount = 0;
  liveConfigFetchCount = 0;
  playerCreateCount = 0;
  playerDestroyCount = 0;
  playStartCount = 0;
  playRequestCount = 0;
  streamConnectCount = 0;
  decoderStartCount = 0;
  firstFrameCount = 0;
  pipelineStage = "IDLE";
  playerCreated = false;
  streamConnected = false;
  decoderStarted = false;
  firstFrameReceived = false;
  videoRendered = false;
  lastErrorCode = null;
  domVideoWidth = 0;
  domVideoHeight = 0;
  domCanvasWidth = 0;
  domCanvasHeight = 0;
  domHasVideo = false;
  domHasCanvas = false;
}

export function setHikvisionLiveStreamContext(meta: {
  cameraId?: string;
  deviceSerialMasked?: string;
  channelNo?: string;
  streamType?: string;
  streamVariant?: "main" | "sub";
  protocol?: string;
  codecHint?: StreamCodecHint;
  tokenPresent?: boolean;
  urlPresent?: boolean;
  expiresAt?: string | null;
}): void {
  if (meta.cameraId !== undefined) cameraId = meta.cameraId;
  if (meta.deviceSerialMasked !== undefined) deviceSerialMasked = meta.deviceSerialMasked;
  if (meta.channelNo !== undefined) channelNo = meta.channelNo;
  if (meta.streamType !== undefined) streamType = meta.streamType;
  if (meta.streamVariant !== undefined) streamVariant = meta.streamVariant;
  if (meta.protocol !== undefined) protocol = meta.protocol;
  if (meta.codecHint !== undefined) codecHint = meta.codecHint;
  if (meta.tokenPresent !== undefined) tokenPresent = meta.tokenPresent;
  if (meta.urlPresent !== undefined) streamUrlPresent = meta.urlPresent;
  if (meta.expiresAt !== undefined) expiresAt = meta.expiresAt;
}

export function setHikvisionLivePipelineStage(stage: HikvisionLivePipelineStage): void {
  pipelineStage = stage;
  if (stage === "CONFIG_OK") {
    /* config loaded */
  } else if (stage === "PLAYER_CREATED") {
    playerCreated = true;
  } else if (stage === "STREAM_CONNECTED") {
    streamConnected = true;
    streamConnectCount += 1;
  } else if (stage === "DECODER_STARTED") {
    decoderStarted = true;
    decoderStartCount += 1;
  } else if (stage === "FIRST_FRAME") {
    firstFrameReceived = true;
    firstFrameCount += 1;
  } else if (stage === "PLAYING") {
    videoRendered = true;
  }
}

export function setHikvisionPlayerDomInspect(meta: {
  videoWidth?: number;
  videoHeight?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  hasVideo?: boolean;
  hasCanvas?: boolean;
}): void {
  if (meta.videoWidth !== undefined) domVideoWidth = meta.videoWidth;
  if (meta.videoHeight !== undefined) domVideoHeight = meta.videoHeight;
  if (meta.canvasWidth !== undefined) domCanvasWidth = meta.canvasWidth;
  if (meta.canvasHeight !== undefined) domCanvasHeight = meta.canvasHeight;
  if (meta.hasVideo !== undefined) domHasVideo = meta.hasVideo;
  if (meta.hasCanvas !== undefined) domHasCanvas = meta.hasCanvas;
}

export function bumpHikvisionSdkLoadCount(): void {
  sdkLoadCount += 1;
}

export function bumpHikvisionLiveConfigFetchCount(): void {
  liveConfigFetchCount += 1;
}

export function bumpHikvisionPlayerCreateCount(): void {
  playerCreateCount += 1;
}

export function bumpHikvisionPlayerDestroyCount(): void {
  playerDestroyCount += 1;
}

export function bumpHikvisionPlayStartCount(): void {
  playStartCount += 1;
}

export function bumpHikvisionPlayRequestCount(): void {
  playRequestCount += 1;
}

export function setHikvisionPlayerPhase(next: HikvisionPlayerRuntimePhase): void {
  phase = next;
}

export function setHikvisionPlayerError(code: HikvisionPlayerFailureCode | null): void {
  lastErrorCode = code;
  if (code) pipelineStage = "FAILED";
}

export function setHikvisionPlayerSdkMeta(scriptUrl: string | null): void {
  lastScriptUrl = scriptUrl;
}

export function setHikvisionPlayerStreamMeta(meta: {
  streamUrlPresent?: boolean;
  expiresAt?: string | null;
  tokenPresent?: boolean;
}): void {
  if (meta.streamUrlPresent !== undefined) streamUrlPresent = meta.streamUrlPresent;
  if (meta.expiresAt !== undefined) expiresAt = meta.expiresAt;
  if (meta.tokenPresent !== undefined) tokenPresent = meta.tokenPresent;
}

export function hikLiveLog(message: string, meta?: Record<string, string | number | boolean>): void {
  if (typeof window === "undefined") return;
  const detail = meta
    ? ` ${Object.entries(meta)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`
    : "";
  console.info(`[HIK LIVE] ${message}${detail}`);
}

export function getHikvisionPlayerRuntimeDiagnostics() {
  return {
    phase,
    pipelineStage,
    lastErrorCode,
    lastScriptUrl,
    streamUrlPresent,
    tokenPresent,
    expiresAt,
    cameraId,
    deviceSerial: deviceSerialMasked,
    channelNo,
    streamType,
    streamVariant,
    protocol,
    codec: codecHint,
    playerCreated,
    streamConnected,
    decoderStarted,
    firstFrameReceived,
    videoRendered,
    sdkLoadCount,
    liveConfigFetchCount,
    playerCreateCount,
    playerDestroyCount,
    playStartCount,
    playRequestCount,
    streamConnectCount,
    decoderStartCount,
    firstFrameCount,
    domVideoWidth,
    domVideoHeight,
    domCanvasWidth,
    domCanvasHeight,
    domHasVideo,
    domHasCanvas,
    updatedAt: new Date().toISOString(),
  };
}
