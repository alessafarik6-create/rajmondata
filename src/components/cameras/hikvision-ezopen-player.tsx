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
  resizePlayerToContainer,
  waitForNonZeroContainerSize,
  watchHikPlayerFirstFrame,
} from "@/components/cameras/hikvision-player-utils";
import {
  ezopenHostToStreamDomain,
  normalizeStreamAreaDomain,
} from "@/lib/hikvision/ezopen-stream-meta";

/** Metadata z API — player používá jen url, token, domain. */
export type EzopenSession = {
  ezopenUrl: string;
  accessToken: string;
  appKey?: string;
  streamAreaDomain?: string;
  expiresAt?: string;
  streamVariant?: "main" | "sub";
  deviceSerialMasked?: string;
  channelNo?: string;
  streamType?: string;
  protocol?: string;
  codecHint?: "H264" | "H265" | "unknown";
  mainStream?: {
    codec: "H264" | "H265" | "unknown";
    width: number | null;
    height: number | null;
    fps: number | null;
    bitrateKbps: number | null;
  };
  subStream?: {
    codec: "H264" | "H265" | "unknown";
    width: number | null;
    height: number | null;
    fps: number | null;
    bitrateKbps: number | null;
  } | null;
  webLiveSelectionReason?: string;
  subCandidateIndex?: number;
  webLiveWarning?: string | null;
};

export type HikvisionLivePlayerErrorCode =
  | HikvisionSdkErrorCode
  | "LIVE_API_FAILED"
  | "STREAM_TOKEN_FAILED"
  | "STREAM_EXPIRED"
  | "DEVICE_OFFLINE"
  | "PLAYER_INIT_FAILED"
  | "PLAY_FAILED"
  | "STREAM_NOT_CONNECTED"
  | "DECODE_FAILED";

export type HikvisionLivePlayerState =
  | "LOADING_SDK"
  | "LOADING_STREAM"
  | "INITIALIZING_PLAYER"
  | "CONNECTING"
  | "PLAYING"
  | "ERROR"
  | "OFFLINE";

function userErrorMessage(code: HikvisionLivePlayerErrorCode | null): string {
  switch (code) {
    case "STREAM_NOT_CONNECTED":
      return "Živý obraz se nepodařilo spustit. Kamera je dostupná, ale video stream nebyl navázán.";
    case "DEVICE_OFFLINE":
      return "Kamera je offline nebo nedostupná.";
    case "LIVE_API_FAILED":
      return "Server nevrátil platný stream (chyba API). Zkuste to znovu nebo kontaktujte správce integrace Hik-Connect.";
    case "STREAM_TOKEN_FAILED":
    case "STREAM_EXPIRED":
      return "Nepodařilo se získat autorizovaný přístup ke streamu. Zkuste obnovit připojení.";
    case "DECODE_FAILED":
    case "PLAY_FAILED":
      return "Video stream se nepodařilo dekódovat v prohlížeči (zkuste substream H.264).";
    default:
      return "Živý obraz se nepodařilo zobrazit.";
  }
}
const LIVE_PLAYER_WIDTH = 800;
const LIVE_PLAYER_HEIGHT = 450;
const LIVE_CONNECT_TIMEOUT_MS = 15_000;

type PlayerInstance = {
  stop: () => void;
  destroy?: () => void;
  play?: () => void;
  openSound: () => void;
  closeSound: () => void;
  fullScreen: () => void;
  on?: (event: string, cb: (info: unknown) => void) => void;
};

function logHik(tag: string, payload?: unknown) {
  if (typeof console === "undefined") return;
  if (payload !== undefined) console.log(tag, payload);
  else console.log(tag);
}

function destroyHikPlayer(
  playerRef: React.MutableRefObject<PlayerInstance | null>,
  cameraId?: string
) {
  if (!playerRef.current) return;
  bumpHikvisionPlayerDestroyCount();
  hikLiveLog("PLAYER DESTROY");
  logHik("[HIK] DESTROY", cameraId ?? "?");
  try {
    playerRef.current.destroy?.();
    playerRef.current.stop();
  } catch (e) {
    logHik("[HIK] ERROR", { phase: "destroy", error: e });
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
  onSubStreamFallback?: () => void;
  onSubStreamCandidateFallback?: () => void;
  compact?: boolean;
  streamErrorCode?: HikvisionLivePlayerErrorCode | null;
  showDeveloperDetail?: boolean;
  /** @deprecated */
  mobileLayout?: boolean;
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
    onSubStreamFallback,
    compact,
    streamErrorCode,
    showDeveloperDetail,
  } = props;

  const containerId = useMemo(
    () => `hik-ezopen-${cameraId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    [cameraId]
  );
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerInstance | null>(null);
  const initStreamKeyRef = useRef<string | null>(null);
  const initializingRef = useRef(false);
  const streamRetriedRef = useRef(false);
  const modeRef = useRef(mode);
  const compactRef = useRef(compact);
  modeRef.current = mode;
  compactRef.current = compact;
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const onSubStreamFallbackRef = useRef(onSubStreamFallback);
  onSubStreamFallbackRef.current = onSubStreamFallback;
  const subStreamTriedRef = useRef(false);
  const renderedFrameRef = useRef(false);

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
      destroyHikPlayer(playerRef, cameraId);
      initStreamKeyRef.current = null;
      initializingRef.current = false;
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
      setUiState("LOADING_STREAM");
      setErrorCode(null);
      return;
    }
  }, [online, streamErrorCode, sdkReady, sdkErrorCode, streamKey, streamLoading, cameraId]);

  useLayoutEffect(() => {
    if (online === false || streamErrorCode || !sdkReady || !streamKey) {
      return;
    }

    if (playerRef.current && initStreamKeyRef.current === streamKey) {
      return;
    }

    if (initializingRef.current && initStreamKeyRef.current === streamKey) {
      return;
    }

    let cancelled = false;
    let stopFrameWatch: (() => void) | null = null;

    const markPlaying = (source: string) => {
      if (cancelled) return;
      const containerEl = playerContainerRef.current;
      if (!hikPlayerContainerHasVideo(containerEl)) {
        logHik("[HIK] PLAY skip — no rendered frame", { cameraId, source });
        return;
      }
      renderedFrameRef.current = true;
      bumpHikvisionPlayStartCount();
      hikLiveLog("PLAYING");
      logHik("[HIK] PLAY RESULT", { cameraId, ok: true, source });
      setUiState("PLAYING");
      setErrorCode(null);
      setHikvisionPlayerPhase("PLAY_STARTED");
      setHikvisionPlayerError(null);
    };

    async function createPlayer() {
      if (cancelled) return;
      if (playerRef.current && initStreamKeyRef.current === streamKey) {
        return;
      }
      if (initializingRef.current) {
        return;
      }

      let containerEl = playerContainerRef.current;
      if (!containerEl) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        containerEl = playerContainerRef.current;
        if (!containerEl || cancelled) {
          initializingRef.current = false;
          return;
        }
      }

      if (playerRef.current && initStreamKeyRef.current !== streamKey) {
        destroyHikPlayer(playerRef, cameraId);
      }

      initializingRef.current = true;
      setUiState("INITIALIZING_PLAYER");
      setErrorCode(null);
      setHikvisionPlayerPhase("PLAYER_CREATING");

      let sized = await waitForNonZeroContainerSize(containerEl);
      if (cancelled) {
        initializingRef.current = false;
        return;
      }
      if (!sized) {
        const isCompact = compactRef.current;
        sized = {
          width: isCompact ? 320 : LIVE_PLAYER_WIDTH,
          height: isCompact ? 180 : LIVE_PLAYER_HEIGHT,
        };
        logHik("[HIK] WARN", { cameraId, phase: "container_size_fallback", sized });
      }

      const EZUIKitPlayer = getHikvisionPlayerConstructor();
      if (!EZUIKitPlayer || cancelled) {
        initializingRef.current = false;
        if (!cancelled) {
          setUiState("ERROR");
          setErrorCode("SDK_API_MISSING");
        }
        return;
      }

      setHikvisionPlayerStreamMeta({ streamUrlPresent: true });
      setHikvisionPlayerPhase("STREAM_CONFIG_LOADED");
      hikLiveLog("CONFIG READY");
      logHik("[HIK] CREATE", { cameraId, w: sized.width, h: sized.height });

      const jssdkCfg = getHikvisionJssdkPublicConfig();
      const liveSession = sessionRef.current;
      if (!liveSession?.ezopenUrl || !liveSession.accessToken) {
        initializingRef.current = false;
        return;
      }

      const domain =
        normalizeStreamAreaDomain(liveSession.streamAreaDomain) ??
        ezopenHostToStreamDomain(liveSession.ezopenUrl);
      const liveMode = modeRef.current;
      const isCompact = compactRef.current;
      const playerWidth = isCompact ? 320 : LIVE_PLAYER_WIDTH;
      const playerHeight = isCompact ? 180 : LIVE_PLAYER_HEIGHT;

      const playerOpts: Record<string, unknown> = {
        id: containerId,
        url: liveSession.ezopenUrl,
        accessToken: liveSession.accessToken,
        staticPath: jssdkCfg.staticPath,
        template: liveMode === "live" ? "simple" : "pcRec",
        plugin: [],
        header: liveMode === "live" ? ["capture"] : [],
        audio: 0,
        width: playerWidth,
        height: playerHeight,
        handleError: (info: unknown) => {
          if (cancelled) return;
          if (hikPlayerContainerHasVideo(containerEl)) {
            markPlaying("handleError_has_video");
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
          logHik("[HIK] PLAY RESULT", { cameraId, ok: false, info });
          logHik("[HIK] ERROR", { cameraId, phase: "sdk_handleError", info });
          setUiState("ERROR");
          setErrorCode("PLAY_FAILED");
          setHikvisionPlayerPhase("PLAY_ERROR");
          setHikvisionPlayerError("PLAY_FAILED");
        },
        handleSuccess: () => {
          if (cancelled) return;
          hikLiveLog("STREAM CONNECTED (sdk)");
          logHik("[HIK] STREAM", { cameraId, phase: "sdk_connected" });
          setUiState("CONNECTING");
          setHikvisionPlayerPhase("STREAM_CONNECTED");
        },
      };
      if (liveSession.appKey) {
        playerOpts.appKey = liveSession.appKey;
      }
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
        logHik("[HIK] PLAY", { cameraId, phase: "player_constructed" });

        player.on?.("play", () => markPlaying("event_play"));
        player.on?.("firstFrame", () => {
          hikLiveLog("FIRST FRAME");
          markPlaying("event_firstFrame");
        });

        stopFrameWatch = watchHikPlayerFirstFrame(containerEl, () => {
          hikLiveLog("FIRST FRAME (dom)");
          markPlaying("dom_firstFrame");
        });

        try {
          player.play?.();
        } catch {
          /* SDK auto-play */
        }
        resizePlayerToContainer(containerEl, player);
      } catch (e) {
        logHik("[HIK] ERROR", { cameraId, phase: "player_init", error: e });
        setUiState("ERROR");
        setErrorCode("PLAYER_INIT_FAILED");
        setHikvisionPlayerPhase("PLAY_ERROR");
        setHikvisionPlayerError("PLAYER_INIT_FAILED");
      } finally {
        initializingRef.current = false;
      }
    }

    void createPlayer();

    return () => {
      cancelled = true;
      stopFrameWatch?.();
    };
  }, [streamKey, sdkReady, online, streamErrorCode, containerId, cameraId]);

  useEffect(() => {
    streamRetriedRef.current = false;
    subStreamTriedRef.current = false;
    renderedFrameRef.current = false;
  }, [streamKey]);

  useEffect(() => {
    if (
      uiState !== "INITIALIZING_PLAYER" &&
      uiState !== "CONNECTING" &&
      uiState !== "LOADING_STREAM"
    ) {
      return;
    }
    const deadline = window.setTimeout(() => {
      const containerEl = playerContainerRef.current;
      if (renderedFrameRef.current || hikPlayerContainerHasVideo(containerEl)) return;
      const liveSession = sessionRef.current;
      const mainCodec = liveSession?.mainStream?.codec ?? liveSession?.codecHint;
      if (
        !subStreamTriedRef.current &&
        onSubStreamFallbackRef.current &&
        liveSession?.streamVariant !== "sub" &&
        (mainCodec === "H265" || liveSession?.webLiveWarning)
      ) {
        subStreamTriedRef.current = true;
        destroyHikPlayer(playerRef, cameraId);
        initStreamKeyRef.current = null;
        setUiState("LOADING_STREAM");
        hikLiveLog("PLAY timeout — sub stream fallback");
        onSubStreamFallbackRef.current();
        return;
      }
      if (!streamRetriedRef.current && onRetryRef.current) {
        streamRetriedRef.current = true;
        destroyHikPlayer(playerRef, cameraId);
        initStreamKeyRef.current = null;
        setUiState("CONNECTING");
        hikLiveLog("PLAY timeout — token retry");
        onRetryRef.current();
        return;
      }
      setUiState("ERROR");
      setErrorCode("STREAM_NOT_CONNECTED");
      setHikvisionPlayerPhase("PLAY_ERROR");
      setHikvisionPlayerError("STREAM_NOT_CONNECTED");
      logHik("[HIK] ERROR", { cameraId, phase: "connect_timeout_ms", ms: LIVE_CONNECT_TIMEOUT_MS });
    }, LIVE_CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(deadline);
  }, [uiState, streamKey, cameraId]);

  useEffect(() => {
    return () => {
      destroyHikPlayer(playerRef, cameraId);
      initStreamKeyRef.current = null;
      initializingRef.current = false;
      if (document.fullscreenElement === shellRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [cameraId]);

  const loadingLabel =
    uiState === "LOADING_SDK"
      ? "Načítám přehrávač…"
      : uiState === "LOADING_STREAM"
        ? "Získávám video stream…"
        : uiState === "CONNECTING"
          ? "Načítám obraz…"
          : uiState === "INITIALIZING_PLAYER"
            ? "Připojuji ke kameře…"
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
    destroyHikPlayer(playerRef, cameraId);
    initStreamKeyRef.current = null;
    initializingRef.current = false;
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

  const shellVideoClass = cn(
    "relative flex-shrink-0 bg-black mx-auto w-full max-w-full",
    compact ? "min-h-[180px]" : fsActive ? "min-h-0 flex-1 h-full w-full" : "h-[450px] max-w-[800px]"
  );

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
          "flex items-center justify-between gap-2 px-3 py-2 bg-black/80 text-xs z-10 shrink-0",
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

      <div className={cn(shellVideoClass, "relative")}>
        <div
          ref={playerContainerRef}
          id={containerId}
          className="absolute inset-0 w-full h-full min-h-[120px] overflow-hidden [&_video]:max-w-full [&_video]:max-h-full [&_canvas]:max-w-full [&_canvas]:max-h-full"
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
              {uiState === "OFFLINE" ? "Kamera je offline." : userErrorMessage(errorCode)}
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
