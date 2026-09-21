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

export function getHikvisionPlayerRuntimeDiagnostics() {
  return {
    phase,
    lastErrorCode,
    lastScriptUrl,
    streamUrlPresent,
    expiresAt,
    updatedAt: new Date().toISOString(),
  };
}
