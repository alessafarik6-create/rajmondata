"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX, Maximize, Minimize, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useHikConnectJssdk } from "@/components/cameras/use-hikconnect-jssdk";
import {
  getHikvisionPlayerConstructor,
  loadHikvisionSdk,
  type HikvisionSdkErrorCode,
} from "@/components/cameras/load-hikvision-sdk";
import { getHikvisionJssdkPublicConfig } from "@/lib/hikvision/jssdk-config-shared";
import {
  setHikvisionPlayerError,
  setHikvisionPlayerPhase,
  setHikvisionPlayerStreamMeta,
} from "@/lib/hikvision/player-runtime-diagnostics";

export type EzopenSession = {
  ezopenUrl: string;
  accessToken: string;
  appKey?: string;
  streamAreaDomain?: string;
};

export type HikvisionLivePlayerErrorCode =
  | HikvisionSdkErrorCode
  | "LIVE_API_FAILED"
  | "STREAM_TOKEN_FAILED"
  | "STREAM_EXPIRED"
  | "DEVICE_OFFLINE"
  | "PLAYER_INIT_FAILED"
  | "PLAY_FAILED";

export type HikvisionLivePlayerState =
  | "LOADING_SDK"
  | "LOADING_STREAM"
  | "INITIALIZING_PLAYER"
  | "PLAYING"
  | "ERROR"
  | "OFFLINE";

const USER_ERROR_MESSAGE = "Živý obraz se nyní nepodařilo načíst.";

export function HikvisionEzopenPlayer(props: {
  session: EzopenSession | null;
  cameraName: string;
  online?: boolean;
  mode: "live" | "playback";
  className?: string;
  onClose?: () => void;
  onRetry?: () => void;
  compact?: boolean;
  streamErrorCode?: HikvisionLivePlayerErrorCode | null;
  showDeveloperDetail?: boolean;
}) {
  const {
    session,
    cameraName,
    online,
    mode,
    className,
    onClose,
    onRetry,
    compact,
    streamErrorCode,
    showDeveloperDetail,
  } = props;
  const containerId = useId().replace(/:/g, "");
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{
    stop: () => void;
    destroy?: () => void;
    openSound: () => void;
    closeSound: () => void;
    fullScreen: () => void;
  } | null>(null);
  const streamRetriedRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [uiState, setUiState] = useState<HikvisionLivePlayerState>("LOADING_SDK");
  const [errorCode, setErrorCode] = useState<HikvisionLivePlayerErrorCode | null>(null);
  const [fsActive, setFsActive] = useState(false);
  const { ready: sdkReady, errorCode: sdkErrorCode } = useHikConnectJssdk(true);

  useEffect(() => {
    const onFs = () => setFsActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useLayoutEffect(() => {
    if (online === false) {
      setUiState("OFFLINE");
      setErrorCode("DEVICE_OFFLINE");
      setHikvisionPlayerPhase("PLAY_ERROR");
      setHikvisionPlayerError("DEVICE_OFFLINE");
      return;
    }

    if (streamErrorCode) {
      setUiState("ERROR");
      setErrorCode(streamErrorCode);
      setHikvisionPlayerPhase("PLAY_ERROR");
      setHikvisionPlayerError(streamErrorCode);
      return;
    }

    if (!sdkReady) {
      if (sdkErrorCode) {
        setUiState("ERROR");
        setErrorCode(sdkErrorCode);
        setHikvisionPlayerPhase("PLAY_ERROR");
        setHikvisionPlayerError(sdkErrorCode);
      } else {
        setUiState("LOADING_SDK");
        setErrorCode(null);
      }
      return;
    }

    if (!session?.ezopenUrl || !session.accessToken) {
      setUiState("LOADING_STREAM");
      setErrorCode(null);
      return;
    }

    setHikvisionPlayerStreamMeta({
      streamUrlPresent: true,
    });
    setHikvisionPlayerPhase("STREAM_CONFIG_LOADED");

    const EZUIKitPlayer = getHikvisionPlayerConstructor();
    if (!EZUIKitPlayer) {
      setUiState("ERROR");
      setErrorCode("SDK_API_MISSING");
      setHikvisionPlayerPhase("PLAY_ERROR");
      setHikvisionPlayerError("SDK_API_MISSING");
      return;
    }

    const containerEl = document.getElementById(containerId);
    if (!containerEl) {
      setUiState("INITIALIZING_PLAYER");
      return;
    }

    setUiState("INITIALIZING_PLAYER");
    setErrorCode(null);
    setHikvisionPlayerPhase("PLAYER_CREATING");

    try {
      playerRef.current?.destroy?.();
      playerRef.current?.stop();
    } catch {
      /* ignore */
    }

    const jssdkCfg = getHikvisionJssdkPublicConfig();
    let cancelled = false;

    const domain = session.streamAreaDomain?.replace(/\/$/, "");
    const playerOpts: Record<string, unknown> = {
      id: containerId,
      url: session.ezopenUrl,
      accessToken: session.accessToken,
      staticPath: jssdkCfg.staticPath,
      template: mode === "live" ? "simple" : "pcRec",
      plugin: mode === "live" ? ["talk"] : [],
      header: mode === "live" ? ["capture"] : [],
      audio: 0,
      width: compact ? 320 : "100%",
      height: compact ? 180 : "100%",
      handleError: () => {
        if (cancelled) return;
        if (!streamRetriedRef.current && onRetry) {
          streamRetriedRef.current = true;
          setUiState("LOADING_STREAM");
          setHikvisionPlayerPhase("STREAM_CONFIG_LOADED");
          onRetry();
          return;
        }
        setUiState("ERROR");
        setErrorCode("PLAY_FAILED");
        setHikvisionPlayerPhase("PLAY_ERROR");
        setHikvisionPlayerError("PLAY_FAILED");
      },
      handleSuccess: () => {
        if (cancelled) return;
        setUiState("PLAYING");
        setErrorCode(null);
        setHikvisionPlayerPhase("PLAY_STARTED");
        setHikvisionPlayerError(null);
      },
    };
    if (domain) {
      playerOpts.env = { domain };
    }

    try {
      const player = new EZUIKitPlayer(playerOpts);
      playerRef.current = player;
      setHikvisionPlayerPhase("PLAYER_CREATED");
    } catch {
      setUiState("ERROR");
      setErrorCode("PLAYER_INIT_FAILED");
      setHikvisionPlayerPhase("PLAY_ERROR");
      setHikvisionPlayerError("PLAYER_INIT_FAILED");
    }

    return () => {
      cancelled = true;
      setHikvisionPlayerPhase("PLAYER_DESTROYED");
      try {
        playerRef.current?.destroy?.();
        playerRef.current?.stop();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [
    session,
    sdkReady,
    sdkErrorCode,
    streamErrorCode,
    containerId,
    compact,
    mode,
    online,
    onRetry,
  ]);

  useEffect(() => {
    streamRetriedRef.current = false;
  }, [session?.ezopenUrl, session?.accessToken]);

  useEffect(() => {
    return () => {
      if (document.fullscreenElement === shellRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const now = new Date().toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const loadingLabel =
    uiState === "LOADING_SDK"
      ? "Načítám přehrávač…"
      : uiState === "LOADING_STREAM"
        ? "Připojuji živý obraz…"
        : "Inicializuji přehrávač…";

  async function toggleFullscreen() {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      playerRef.current?.fullScreen?.();
    }
  }

  async function retryAll() {
    setUiState("LOADING_SDK");
    setErrorCode(null);
    const sdk = await loadHikvisionSdk();
    if (!sdk.ok) {
      setUiState("ERROR");
      setErrorCode(sdk.code);
      return;
    }
    onRetry?.();
  }

  const showErrorOverlay =
    uiState === "ERROR" || uiState === "OFFLINE" || (uiState === "LOADING_SDK" && sdkErrorCode);

  const showLoadingOverlay =
    (uiState === "LOADING_SDK" ||
      uiState === "LOADING_STREAM" ||
      uiState === "INITIALIZING_PLAYER") &&
    !showErrorOverlay;

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative flex flex-col bg-black text-white overflow-hidden",
        fsActive ? "w-screen h-screen rounded-none" : "rounded-md",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 bg-black/80 text-xs z-10",
          fsActive && "absolute top-0 left-0 right-0"
        )}
      >
        <div className="min-w-0">
          <p className="font-medium truncate">{cameraName}</p>
          <p className="text-white/70">{now}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mode === "live" ? (
            <Badge className="bg-red-600 animate-pulse">LIVE</Badge>
          ) : (
            <Badge variant="secondary">Záznam</Badge>
          )}
          <Badge
            className={cn(
              online === false ? "bg-slate-500" : online === true ? "bg-green-600" : "bg-amber-600"
            )}
          >
            {online === false ? "Offline" : online === true ? "Online" : "Neznámý"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white hover:bg-white/10"
            onClick={() => {
              if (!playerRef.current) return;
              if (muted) {
                playerRef.current.openSound();
                setMuted(false);
              } else {
                playerRef.current.closeSound();
                setMuted(true);
              }
            }}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-white hover:bg-white/10"
            onClick={() => void toggleFullscreen()}
          >
            {fsActive ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
          {onClose ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/10"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "relative flex-1 bg-black min-h-[200px]",
          !compact && !fsActive && "aspect-video w-full",
          fsActive && "w-full h-full min-h-0"
        )}
      >
        <div id={containerId} className="absolute inset-0 w-full h-full" />
        {showLoadingOverlay ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 z-20">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">{loadingLabel}</p>
          </div>
        ) : null}
        {showErrorOverlay ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center bg-black/80 z-20">
            <p className="text-sm">
              {uiState === "OFFLINE" ? "Kamera je offline." : USER_ERROR_MESSAGE}
            </p>
            {showDeveloperDetail && errorCode ? (
              <p className="text-xs text-white/60 font-mono">Detail: {errorCode}</p>
            ) : null}
            {onRetry ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void retryAll()}>
                Zkusit znovu
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
