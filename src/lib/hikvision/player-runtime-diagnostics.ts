/** Bezpečná runtime diagnostika Hikvision live playeru (admin / dev). */

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
let lastErrorCode: string | null = null;
let lastScriptUrl: string | null = null;
let streamUrlPresent = false;
let expiresAt: string | null = null;

let sdkLoadCount = 0;
let liveConfigFetchCount = 0;
let playerCreateCount = 0;
let playerDestroyCount = 0;
let playStartCount = 0;

export function resetHikvisionPlayerDebugCounters(): void {
  sdkLoadCount = 0;
  liveConfigFetchCount = 0;
  playerCreateCount = 0;
  playerDestroyCount = 0;
  playStartCount = 0;
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

export function setHikvisionPlayerPhase(next: HikvisionPlayerRuntimePhase): void {
  phase = next;
}

export function setHikvisionPlayerError(code: string | null): void {
  lastErrorCode = code;
}

export function setHikvisionPlayerSdkMeta(scriptUrl: string | null): void {
  lastScriptUrl = scriptUrl;
}

export function setHikvisionPlayerStreamMeta(meta: {
  streamUrlPresent?: boolean;
  expiresAt?: string | null;
}): void {
  if (meta.streamUrlPresent !== undefined) streamUrlPresent = meta.streamUrlPresent;
  if (meta.expiresAt !== undefined) expiresAt = meta.expiresAt;
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
    lastErrorCode,
    lastScriptUrl,
    streamUrlPresent,
    expiresAt,
    sdkLoadCount,
    liveConfigFetchCount,
    playerCreateCount,
    playerDestroyCount,
    playStartCount,
    updatedAt: new Date().toISOString(),
  };
}
