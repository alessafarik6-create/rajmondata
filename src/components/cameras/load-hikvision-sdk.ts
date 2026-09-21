"use client";

import {
  getHikvisionJssdkPublicConfig,
  type HikvisionJssdkPublicConfig,
} from "@/lib/hikvision/jssdk-config-shared";
import {
  setHikvisionPlayerError,
  setHikvisionPlayerPhase,
  setHikvisionPlayerSdkMeta,
} from "@/lib/hikvision/player-runtime-diagnostics";

export type HikvisionSdkErrorCode =
  | "SDK_FETCH_FAILED"
  | "SDK_ASSET_FAILED"
  | "SDK_NOT_FOUND"
  | "SDK_LOAD_FAILED"
  | "SDK_LOAD_TIMEOUT"
  | "SDK_API_MISSING";

export type HikvisionSdkLoadResult =
  | { ok: true; config: HikvisionJssdkPublicConfig; scriptUrl: string }
  | { ok: false; code: HikvisionSdkErrorCode; message: string; scriptUrl: string };

declare global {
  interface Window {
    EZUIKit?: {
      EZUIKitPlayer: new (opts: Record<string, unknown>) => {
        stop: () => void;
        play: () => void;
        openSound: () => void;
        closeSound: () => void;
        fullScreen: () => void;
        cancelFullScreen: () => void;
        destroy?: () => void;
        on?: (event: string, cb: (info: unknown) => void) => void;
      };
    };
  }
}

const LOAD_TIMEOUT_MS = 45_000;

let loadFlight: Promise<HikvisionSdkLoadResult> | null = null;

export type HikvisionEzUIKitPlayerCtor = new (opts: Record<string, unknown>) => {
  stop: () => void;
  play: () => void;
  openSound: () => void;
  closeSound: () => void;
  fullScreen: () => void;
  cancelFullScreen: () => void;
  destroy?: () => void;
  on?: (event: string, cb: (info: unknown) => void) => void;
};

export function getHikvisionPlayerConstructor(): HikvisionEzUIKitPlayerCtor | null {
  if (typeof window === "undefined") return null;
  return (window.EZUIKit?.EZUIKitPlayer as HikvisionEzUIKitPlayerCtor | undefined) ?? null;
}

export function isHikvisionSdkReady(): boolean {
  return Boolean(getHikvisionPlayerConstructor());
}

function sdkCacheBustQuery(): string {
  const v =
    String(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_BUILD_ID ?? "").trim();
  return v ? `?v=${encodeURIComponent(v.slice(0, 12))}` : "";
}

function withCacheBust(src: string): string {
  if (!src.startsWith("/") || src.includes("?")) return src;
  return `${src}${sdkCacheBustQuery()}`;
}

function appendScript(src: string): Promise<void> {
  const resolved = withCacheBust(src);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-hik-jssdk="${resolved}"]`) as
      | HTMLScriptElement
      | null;
    if (existing) {
      if (existing.dataset.hikJssdkLoaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("script error")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = resolved;
    script.async = true;
    script.dataset.hikJssdk = resolved;
    script.onload = () => {
      script.dataset.hikJssdkLoaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("script error"));
    document.head.appendChild(script);
  });
}

function appendStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const resolved = withCacheBust(href);
    if (document.querySelector(`link[data-hik-jssdk-css="${resolved}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = resolved;
    link.dataset.hikJssdkCss = resolved;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

async function tryLoadScriptCandidate(scriptUrl: string): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
  });
  try {
    await Promise.race([appendScript(scriptUrl), timeout]);
    return isHikvisionSdkReady();
  } catch {
    return false;
  }
}

async function loadHikvisionSdkInternal(): Promise<HikvisionSdkLoadResult> {
  if (typeof window === "undefined") {
    return {
      ok: false,
      code: "SDK_LOAD_FAILED",
      message: "SDK lze načíst pouze v prohlížeči.",
      scriptUrl: "",
    };
  }

  const config = getHikvisionJssdkPublicConfig();
  const scriptCandidates = [
    config.scriptUrl,
    "/hikvision-jssdk/ezuikit.js",
    "/hikvision-jssdk/ezUIKit.js",
  ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);

  if (isHikvisionSdkReady()) {
    setHikvisionPlayerPhase("SDK_LOADED");
    setHikvisionPlayerSdkMeta(scriptCandidates[0] ?? config.scriptUrl);
    return { ok: true, config, scriptUrl: scriptCandidates[0] ?? config.scriptUrl };
  }

  setHikvisionPlayerPhase("SDK_LOADING");
  setHikvisionPlayerError(null);

  if (config.cssUrl) {
    await appendStylesheet(config.cssUrl);
  }

  for (const candidate of scriptCandidates) {
    const ok = await tryLoadScriptCandidate(candidate);
    if (ok) {
      setHikvisionPlayerPhase("SDK_LOADED");
      setHikvisionPlayerSdkMeta(candidate);
      return { ok: true, config, scriptUrl: candidate };
    }
  }

  setHikvisionPlayerPhase("PLAY_ERROR");
  setHikvisionPlayerError("SDK_FETCH_FAILED");
  const scriptUrl = scriptCandidates[0] ?? config.scriptUrl;
  return {
    ok: false,
    code: "SDK_FETCH_FAILED",
    message: "Hikvision JSSDK se nepodařilo stáhnout (síť nebo 404).",
    scriptUrl,
  };
}

/** Jednorázové načtení oficiálního EZUIKit UMD (window.EZUIKit.EZUIKitPlayer). */
export function loadHikvisionSdk(): Promise<HikvisionSdkLoadResult> {
  if (typeof window !== "undefined" && isHikvisionSdkReady()) {
    const config = getHikvisionJssdkPublicConfig();
    return Promise.resolve({ ok: true, config, scriptUrl: config.scriptUrl });
  }
  if (!loadFlight) {
    loadFlight = loadHikvisionSdkInternal().finally(() => {
      loadFlight = null;
    });
  }
  return loadFlight;
}
