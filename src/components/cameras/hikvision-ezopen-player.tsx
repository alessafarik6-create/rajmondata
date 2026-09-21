"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  bumpHikvisionPlayStartCount,
  bumpHikvisionPlayerCreateCount,
  bumpHikvisionPlayerDestroyCount,
  hikLiveLog,
  setHikvisionPlayerError,
  setHikvisionPlayerPhase,
  setHikvisionPlayerStreamMeta,
} from "@/lib/hikvision/player-runtime-diagnostics";
import {
  hikPlayerContainerHasVideo,
  isLikelyHikStreamFatalError,
  waitForNonZeroContainerSize,
  watchHikPlayerFirstFrame,
} from "@/components/cameras/hikvision-player-utils";

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
  | "CONNECTING"
  | "PLAYING"
  | "ERROR"
  | "OFFLINE";

const USER_ERROR_MESSAGE = "Živý obraz se nyní nepodařilo načíst.";

type PlayerInstance = {
  stop: () => void;
  destroy?: () => void;
  openSound: () => void;
  closeSound: () => void;
  fullScreen: () => void;
  on?: (event: string, cb: (info: unknown) => void) => void;
};

function destroyHikPlayer(playerRef: React.MutableRefObject<PlayerInstance | null>) {
  if (!playerRef.current) return;
  bumpHikvisionPlayerDestroyCount();
  hikLiveLog("PLAYER DESTROY");
  try {
    playerRef.current.destroy?.();
    playerRef.current.stop();
  } catch {
    /* ignore */
  }
  playerRef.current = null;
}

export function HikvisionEzopenPlayer(props: {
  cameraId: string;
  session: EzopenSession | null;
  streamLoading?: boolean;
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
    cameraId,
    session,
    streamLoading,
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

  const containerId = useMemo(() => `hik-ezopen-${cameraId.replace(/[^a-zA-Z0-9_-]/g, "_")}`, [cameraId]);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerInstance | null>(null);
  const initStreamKeyRef = useRef<string | null>(null);
  const initInFlightRef = useRef(false);
  const streamRetriedRef = useRef(false);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const [muted, setMuted] = useState(true);
  const [uiState, setUiState] = useState<HikvisionLivePlayerState>("LOADING_SDK");
  const [errorCode, setErrorCode] = useState<HikvisionLivePlayerErrorCode | null>(null);
  const [fsActive, setFsActive] = useState(false);
  const [clock, setClock] = useState("");
  const { ready: sdkReady, errorCode: sdkErrorCode } = useHikConnectJssdk(true);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const streamKey = useMemo(() => {
    if (!session?.ezopenUrl || !session.accessToken) return "";
    return `${session.ezopenUrl}\0${session.accessToken}`;
  }, [session?.ezopenUrl, session?.accessToken]);

  useEffect(() => {
    hikLiveLog("OPEN", { camera: cameraId });
  }, [cameraId]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("cs-CZ", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onFs = () => setFsActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (online === false) {
      setUiState("OFFLINE");
      setErrorCode("DEVICE_OFFLINE");
      setHikvisionPlayerPhase("PLAY_ERROR");
      setHikvisionPlayerError("DEVICE_OFFLINE");
      destroyHikPlayer(playerRef);
      initStreamKeyRef.current = null;
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
      } else {
        setUiState("LOADING_SDK");
        setErrorCode(null);
      }
      return;
    }
    if (!streamKey) {
      setUiState(streamLoading ? "LOADING_STREAM" : "LOADING_STREAM");
      setErrorCode(null);
      return;
    }
  }, [online, streamErrorCode, sdkReady, sdkErrorCode, streamKey, streamLoading]);

  useLayoutEffect(() => {
    if (online === false || streamErrorCode || !sdkReady || !streamKey) {
      return;
    }

    if (playerRef.current && initStreamKeyRef.current === streamKey) {
      return;
    }

    if (initInFlightRef.current && initStreamKeyRef.current === streamKey) {
      return;
    }

    let cancelled = false;
    let stopFrameWatch: (() => void) | null = null;

    const markPlaying = () => {
      if (cancelled) return;
      bumpHikvisionPlayStartCount();
      hikLiveLog("PLAYING");
      setUiState("PLAYING");
      setErrorCode(null);
      setHikvisionPlayerPhase("PLAY_STARTED");
      setHikvisionPlayerError(null);
    };

    async function createPlayer() {
      if (cancelled) return;
      const containerEl = playerContainerRef.current;
      if (!containerEl) return;

      if (playerRef.current && initStreamKeyRef.current !== streamKey) {
        destroyHikPlayer(playerRef);
      }

      initInFlightRef.current = true;
      setUiState("INITIALIZING_PLAYER");
      setErrorCode(null);
      setHikvisionPlayerPhase("PLAYER_CREATING");

      const sized = await waitForNonZeroContainerSize(containerEl);
      if (cancelled || !sized) {
        initInFlightRef.current = false;
        return;
      }

      const EZUIKitPlayer = getHikvisionPlayerConstructor();
      if (!EZUIKitPlayer || cancelled) {
        initInFlightRef.current = false;
        if (!cancelled) {
          setUiState("ERROR");
          setErrorCode("SDK_API_MISSING");
        }
        return;
      }

      setHikvisionPlayerStreamMeta({ streamUrlPresent: true });
      setHikvisionPlayerPhase("STREAM_CONFIG_LOADED");
      hikLiveLog("CONFIG READY");
      hikLiveLog("PLAYER CREATE");

      const jssdkCfg = getHikvisionJssdkPublicConfig();
      const liveSession = sessionRef.current;
      if (!liveSession?.ezopenUrl || !liveSession.accessToken) {
        initInFlightRef.current = false;
        return;
      }

      const domain = liveSession.streamAreaDomain?.replace(/\/$/, "");

      const playerOpts: Record<string, unknown> = {
        id: containerId,
        url: liveSession.ezopenUrl,
        accessToken: liveSession.accessToken,
        staticPath: jssdkCfg.staticPath,
        template: mode === "live" ? "simple" : "pcRec",
        plugin: [],
        header: mode === "live" ? ["capture"] : [],
        audio: 0,
        width: compact ? 320 : "100%",
        height: compact ? 180 : "100%",
        handleError: (info: unknown) => {
          if (cancelled) return;
          if (hikPlayerContainerHasVideo(containerEl)) {
            markPlaying();
            return;
          }
          if (!isLikelyHikStreamFatalError(info)) {
            hikLiveLog("PLAY non-fatal SDK error ignored");
            setUiState("CONNECTING");
            return;
          }
          if (!streamRetriedRef.current && onRetryRef.current) {
            streamRetriedRef.current = true;
            hikLiveLog("PLAY fatal — single token retry");
            setUiState("CONNECTING");
            onRetryRef.current();
            return;
          }
          setUiState("ERROR");
          setErrorCode("PLAY_FAILED");
          setHikvisionPlayerPhase("PLAY_ERROR");
          setHikvisionPlayerError("PLAY_FAILED");
        },
        handleSuccess: () => {
          if (cancelled) return;
          hikLiveLog("PLAY START");
          markPlaying();
        },
      };
      if (domain) {
        playerOpts.env = { domain };
      }

      try {
        bumpHikvisionPlayerCreateCount();
        const player = new EZUIKitPlayer(playerOpts) as PlayerInstance;
        playerRef.current = player;
        initStreamKeyRef.current = streamKey;
        setHikvisionPlayerPhase("PLAYER_CREATED");
        setUiState("CONNECTING");

        player.on?.("play", () => markPlaying());
        player.on?.("firstFrame", () => {
          hikLiveLog("FIRST FRAME");
          markPlaying();
        });

        stopFrameWatch = watchHikPlayerFirstFrame(containerEl, () => {
          hikLiveLog("FIRST FRAME (dom)");
          markPlaying();
        });
      } catch {
        setUiState("ERROR");
        setErrorCode("PLAYER_INIT_FAILED");
        setHikvisionPlayerPhase("PLAY_ERROR");
        setHikvisionPlayerError("PLAYER_INIT_FAILED");
      } finally {
        initInFlightRef.current = false;
      }
    }

    void createPlayer();

    return () => {
      cancelled = true;
      stopFrameWatch?.();
    };
  }, [streamKey, sdkReady, online, streamErrorCode, containerId, compact, mode]);

  useEffect(() => {
    streamRetriedRef.current = false;
  }, [streamKey]);

  useEffect(() => {
    return () => {
      destroyHikPlayer(playerRef);
      initStreamKeyRef.current = null;
      if (document.fullscreenElement === shellRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [cameraId]);

  const loadingLabel =
    uiState === "LOADING_SDK"
      ? "Načítám přehrávač…"
      : uiState === "LOADING_STREAM"
        ? "Připojuji živý obraz…"
        : uiState === "CONNECTING"
          ? "Připojuji stream…"
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
    destroyHikPlayer(playerRef);
    initStreamKeyRef.current = null;
    setUiState("LOADING_SDK");
    setErrorCode(null);
    const sdk = await loadHikvisionSdk();
    if (!sdk.ok) {
      setUiState("ERROR");
      setErrorCode(sdk.code);
      return;
    }
    onRetryRef.current?.();
  }

  const showErrorOverlay =
    uiState === "ERROR" || uiState === "OFFLINE" || (uiState === "LOADING_SDK" && sdkErrorCode);

  const showLoadingOverlay =
    (uiState === "LOADING_SDK" ||
      uiState === "LOADING_STREAM" ||
      uiState === "INITIALIZING_PLAYER" ||
      uiState === "CONNECTING") &&
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
          <p className="text-white/70">{clock}</p>
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
                try {
                  playerRef.current.openSound();
                } catch {
                  /* autoplay policy */
                }
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
        <div
          ref={playerContainerRef}
          id={containerId}
          className="absolute inset-0 w-full h-full"
        />
        {showLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 z-20">
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
