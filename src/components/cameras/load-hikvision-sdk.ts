"use client";

import {
  getHikvisionJssdkPublicConfig,
  type HikvisionJssdkPublicConfig,
} from "@/lib/hikvision/jssdk-config-shared";

export type HikvisionSdkErrorCode =
  | "SDK_NOT_FOUND"
  | "SDK_LOAD_FAILED"
  | "SDK_LOAD_TIMEOUT"
  | "SDK_API_MISSING";

export type HikvisionSdkLoadResult =
  | { ok: true; config: HikvisionJssdkPublicConfig }
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

function appendScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-hik-jssdk="${src}"]`) as
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
    script.src = src;
    script.async = true;
    script.dataset.hikJssdk = src;
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
    if (document.querySelector(`link[data-hik-jssdk-css="${href}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.hikJssdkCss = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

async function probeScriptUrl(scriptUrl: string): Promise<boolean> {
  try {
    const res = await fetch(scriptUrl, { method: "HEAD", cache: "no-store" });
    if (res.status === 405) {
      const getRes = await fetch(scriptUrl, { method: "GET", cache: "no-store" });
      return getRes.ok;
    }
    return res.ok;
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
  const scriptUrl = config.scriptUrl;

  if (isHikvisionSdkReady()) {
    return { ok: true, config };
  }

  const reachable = await probeScriptUrl(scriptUrl);
  if (!reachable) {
    return {
      ok: false,
      code: "SDK_NOT_FOUND",
      message: "Hikvision JSSDK soubor nebyl nalezen.",
      scriptUrl,
    };
  }

  if (config.cssUrl) {
    await appendStylesheet(config.cssUrl);
  }

  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
  });

  try {
    await Promise.race([appendScript(scriptUrl), timeout]);
  } catch (e) {
    if (e instanceof Error && e.message === "timeout") {
      return {
        ok: false,
        code: "SDK_LOAD_TIMEOUT",
        message: "Načtení Hikvision JSSDK vypršelo.",
        scriptUrl,
      };
    }
    return {
      ok: false,
      code: "SDK_LOAD_FAILED",
      message: "Načtení Hikvision JSSDK selhalo.",
      scriptUrl,
    };
  }

  if (!isHikvisionSdkReady()) {
    return {
      ok: false,
      code: "SDK_API_MISSING",
      message: "Hikvision SDK bylo načteno, ale player API není dostupné.",
      scriptUrl,
    };
  }

  return { ok: true, config };
}

/** Jednorázové načtení oficiálního EZUIKit UMD (window.EZUIKit.EZUIKitPlayer). */
export function loadHikvisionSdk(): Promise<HikvisionSdkLoadResult> {
  if (typeof window !== "undefined" && isHikvisionSdkReady()) {
    return Promise.resolve({ ok: true, config: getHikvisionJssdkPublicConfig() });
  }
  if (!loadFlight) {
    loadFlight = loadHikvisionSdkInternal().finally(() => {
      loadFlight = null;
    });
  }
  return loadFlight;
}
