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
  bumpHikvisionPlayRequestCount,
  bumpHikvisionPlayStartCount,
  bumpHikvisionPlayerCreateCount,
  bumpHikvisionPlayerDestroyCount,
  hikLiveLog,
  setHikvisionLivePipelineStage,
  setHikvisionLiveStreamContext,
  setHikvisionPlayerDomInspect,
  setHikvisionPlayerError,
  setHikvisionPlayerPhase,
  setHikvisionPlayerStreamMeta,
} from "@/lib/hikvision/player-runtime-diagnostics";
import { parseEzopenLiveUrl } from "@/lib/hikvision/ezopen-stream-meta";
import {
  hikPlayerContainerHasVideo,
  inspectHikPlayerDom,
  resizePlayerToContainer,
  waitForNonZeroContainerSize,
  watchHikPlayerFirstFrame,
} from "@/components/cameras/hikvision-player-utils";
import "@/components/cameras/hikvision-player-styles.css";
import { useIsMobile } from "@/hooks/use-mobile";

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
};

export type HikvisionLivePlayerErrorCode =
  | HikvisionSdkErrorCode
  | "LIVE_API_FAILED"
  | "STREAM_TOKEN_FAILED"
  | "STREAM_EXPIRED"
  | "DEVICE_OFFLINE"
  | "PLAYER_INIT_FAILED"
  | "PLAY_FAILED"
  | "NO_VIDEO_FRAME"
  | "PLAYER_RENDER_FAILED";

export type HikvisionLivePlayerState =
  | "LOADING_SDK"
  | "LOADING_STREAM"
  | "INITIALIZING_PLAYER"
  | "CONNECTING"
  | "WAITING_FIRST_FRAME"
  | "PLAYING"
  | "ERROR"
  | "OFFLINE";

const USER_ERROR_MESSAGE = "Živý obraz se nepodařilo zobrazit.";
const PLAYER_PLAY_TIMEOUT_MS = 20_000;
const FIRST_FRAME_TIMEOUT_MS = 20_000;

type PlayerInstance = {
  stop: () => void;
  destroy?: () => void;
  openSound: () => void;
  closeSound: () => void;
  fullScreen: () => void;
  on?: (event: string, cb: (info: unknown) => void) => void;
};

function sanitizeHikSdkInfo(info: unknown): Record<string, string | number | boolean> {
  if (info == null) return { empty: true };
  if (typeof info === "string") {
    return { message: info.slice(0, 200) };
  }
  if (typeof info === "object") {
    const o = info as Record<string, unknown>;
    const out: Record<string, string | number | boolean> = {};
    for (const k of ["type", "retcode", "nErrorCode", "code", "msg", "message"]) {
      if (o[k] != null) out[k] = String(o[k]).slice(0, 120);
    }
    return Object.keys(out).length ? out : { json: JSON.stringify(info).slice(0, 200) };
  }
  return { value: String(info).slice(0, 120) };
}

function logStreamMeta(session: EzopenSession, cameraLabel: string): void {
  const parsed = parseEzopenLiveUrl(session.ezopenUrl);
  const scheme = parsed?.protocol ?? session.protocol ?? "ezopen";
  hikLiveLog("STREAM", {
    scheme,
    channel: session.channelNo ?? parsed?.channelNo ?? "?",
    streamType: session.streamType ?? parsed?.streamSuffix ?? "?",
    streamVariant: session.streamVariant ?? "?",
    codec: session.codecHint ?? "unknown",
    camera: cameraLabel,
    accessTokenPresent: Boolean(session.accessToken),
    accessTokenLength: session.accessToken?.length ?? 0,
  });
}

async function requestEzUIKitPlay(player: PlayerInstance): Promise<unknown> {
  bumpHikvisionPlayRequestCount();
  setHikvisionLivePipelineStage("PLAY_REQUESTED");
  hikLiveLog("PLAY REQUEST");
  const p = player as Record<string, unknown>;
  const playFn = p.play;
  if (typeof playFn !== "function") {
    hikLiveLog("PLAY RESULT", { skipped: true, reason: "no play()" });
    return null;
  }
  try {
    const result = playFn.call(player);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const settled = await (result as Promise<unknown>);
      hikLiveLog("PLAY RESULT", sanitizeHikSdkInfo(settled));
      return settled;
    }
    hikLiveLog("PLAY RESULT", { ok: true });
    return result;
  } catch (e) {
    hikLiveLog("PLAY FAILED", {
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

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
  /** Jednorázový fallback main → sub stream (nová session z API). */
  onSubStreamFallback?: () => void;
  compact?: boolean;
  streamErrorCode?: HikvisionLivePlayerErrorCode | null;
  showDeveloperDetail?: boolean;
  /** Mobil: 16:9 přes šířku, contain — bez natažení na celou výšku obrazovky. */
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
    mobileLayout,
  } = props;

  const isMobileHook = useIsMobile();
  const mobileFit = mobileLayout ?? isMobileHook;

  const playerContainerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerInstance | null>(null);
  const initStreamKeyRef = useRef<string | null>(null);
  const initInFlightRef = useRef(false);
  const playerSessionRef = useRef(0);
  const playSuccessRef = useRef(false);
  const playingConfirmedRef = useRef(false);
  const modeRef = useRef(mode);
  const compactRef = useRef(compact);
  modeRef.current = mode;
  compactRef.current = compact;
  const onRetryRef = useRef(onRetry);
  const onSubStreamFallbackRef = useRef(onSubStreamFallback);
  onRetryRef.current = onRetry;
  onSubStreamFallbackRef.current = onSubStreamFallback;

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

  const playerDomSessionId = useMemo(() => {
    if (!streamKey) return "0";
    let h = 2166136261;
    for (let i = 0; i < streamKey.length; i++) {
      h ^= streamKey.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }, [streamKey]);

  const containerId = useMemo(
    () =>
      `hik-player-${cameraId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${playerDomSessionId}`,
    [cameraId, playerDomSessionId]
  );

  useEffect(() => {
    hikLiveLog("OPEN", { camera: cameraId });
    setHikvisionLiveStreamContext({ cameraId });
  }, [cameraId]);

  useEffect(() => {
    const s = sessionRef.current;
    if (!s) return;
    setHikvisionLiveStreamContext({
      cameraId,
      deviceSerialMasked: s.deviceSerialMasked,
      channelNo: s.channelNo,
      streamType: s.streamType,
      streamVariant: s.streamVariant,
      protocol: s.protocol ?? "ezopen",
      codecHint: s.codecHint,
      tokenPresent: Boolean(s.accessToken),
      urlPresent: Boolean(s.ezopenUrl),
      expiresAt: s.expiresAt ?? null,
    });
    setHikvisionLivePipelineStage("CONFIG_OK");
    hikLiveLog("CONFIG_OK");
  }, [streamKey, cameraId]);

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
    const onFs = () => {
      setFsActive(Boolean(document.fullscreenElement));
      requestAnimationFrame(() =>
        resizePlayerToContainer(playerContainerRef.current, playerRef.current)
      );
    };
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

    const mySession = ++playerSessionRef.current;
    let cancelled = false;
    let stopFrameWatch: (() => void) | null = null;
    let playerPlayTimer: number | null = null;
    let firstFrameTimer: number | null = null;

    const markPlaying = (containerEl: HTMLElement) => {
      if (mySession !== playerSessionRef.current) return;
      if (cancelled || playingConfirmedRef.current) return;
      const inspect = inspectHikPlayerDom(containerEl);
      setHikvisionPlayerDomInspect({
        videoWidth: inspect.videoWidth,
        videoHeight: inspect.videoHeight,
        canvasWidth: inspect.canvasWidth,
        canvasHeight: inspect.canvasHeight,
        hasVideo: inspect.hasVideo,
        hasCanvas: inspect.hasCanvas,
      });
      if (!inspect.firstFrameLikely) {
        if (inspect.hasVideo || inspect.hasCanvas) {
          setHikvisionLivePipelineStage("DECODER_STARTED");
        }
        return;
      }
      playingConfirmedRef.current = true;
      if (firstFrameTimer) {
        clearTimeout(firstFrameTimer);
        firstFrameTimer = null;
      }
      setHikvisionLivePipelineStage("FIRST_FRAME");
      hikLiveLog("FIRST_FRAME");
      bumpHikvisionPlayStartCount();
      setHikvisionLivePipelineStage("PLAYING");
      hikLiveLog("PLAYING");
      setUiState("PLAYING");
      setErrorCode(null);
      setHikvisionPlayerPhase("PLAY_STARTED");
      setHikvisionPlayerError(null);
      resizePlayerToContainer(containerEl, playerRef.current);
    };

    const failPlayerPlayTimeout = () => {
      if (cancelled || playingConfirmedRef.current || playSuccessRef.current) return;
      setUiState("ERROR");
      setErrorCode("PLAY_FAILED");
      setHikvisionPlayerError("PLAYER_PLAY_TIMEOUT");
      setHikvisionPlayerPhase("PLAY_ERROR");
      hikLiveLog("PLAYER_PLAY_TIMEOUT");
    };

    const failNoFirstFrame = (containerEl: HTMLElement) => {
      if (cancelled || playingConfirmedRef.current) return;
      if (mySession !== playerSessionRef.current) return;
      const inspect = inspectHikPlayerDom(containerEl);
      setHikvisionPlayerDomInspect({
        videoWidth: inspect.videoWidth,
        videoHeight: inspect.videoHeight,
        canvasWidth: inspect.canvasWidth,
        canvasHeight: inspect.canvasHeight,
        hasVideo: inspect.hasVideo,
        hasCanvas: inspect.hasCanvas,
      });
      setUiState("ERROR");
      setErrorCode("NO_VIDEO_FRAME");
      setHikvisionPlayerError("NO_FIRST_FRAME");
      setHikvisionPlayerPhase("PLAY_ERROR");
      hikLiveLog("NO_VIDEO_FRAME", {
        channel: sessionRef.current?.channelNo ?? "?",
        stream: sessionRef.current?.streamType ?? "?",
        codec: sessionRef.current?.codecHint ?? "unknown",
      });
    };

    async function createPlayer() {
      if (cancelled || mySession !== playerSessionRef.current) return;

      const domTarget = document.getElementById(containerId);
      const containerEl = playerContainerRef.current;
      if (!containerEl || !domTarget) {
        hikLiveLog("PLAYER_CONTAINER_MISSING", { id: containerId });
        setUiState("ERROR");
        setErrorCode("PLAYER_INIT_FAILED");
        return;
      }

      if (playerRef.current && initStreamKeyRef.current !== streamKey) {
        destroyHikPlayer(playerRef);
      }

      initInFlightRef.current = true;
      playSuccessRef.current = false;
      playingConfirmedRef.current = false;
      setUiState("INITIALIZING_PLAYER");
      setErrorCode(null);
      setHikvisionPlayerPhase("PLAYER_CREATING");
      setHikvisionLivePipelineStage("PLAYER_CREATING");

      const sized = await waitForNonZeroContainerSize(containerEl);
      if (cancelled || mySession !== playerSessionRef.current || !sized) {
        initInFlightRef.current = false;
        return;
      }
      hikLiveLog("CONTAINER SIZE", { width: sized.width, height: sized.height });

      const EZUIKitPlayer = getHikvisionPlayerConstructor();
      if (!EZUIKitPlayer || cancelled) {
        initInFlightRef.current = false;
        if (!cancelled) {
          setUiState("ERROR");
          setErrorCode("SDK_API_MISSING");
        }
        return;
      }

      const jssdkCfg = getHikvisionJssdkPublicConfig();
      const liveSession = sessionRef.current;
      if (!liveSession?.ezopenUrl || !liveSession.accessToken) {
        initInFlightRef.current = false;
        return;
      }

      if (!/^ezopen:\/\//i.test(liveSession.ezopenUrl.trim())) {
        hikLiveLog("STREAM URL invalid (not ezopen)");
        setUiState("ERROR");
        setErrorCode("PLAY_FAILED");
        initInFlightRef.current = false;
        return;
      }

      logStreamMeta(liveSession, cameraName);
      setHikvisionPlayerStreamMeta({
        streamUrlPresent: true,
        tokenPresent: true,
      });

      hikLiveLog("PLAYER CREATE");
      const liveMode = modeRef.current;
      const isCompact = compactRef.current;
      const playerW = isCompact ? 320 : sized.width;
      const playerH = isCompact ? 180 : sized.height;
      const domain = liveSession.streamAreaDomain?.replace(/\/$/, "");

      const playerOpts: Record<string, unknown> = {
        id: containerId,
        url: liveSession.ezopenUrl.trim(),
        accessToken: liveSession.accessToken,
        staticPath: jssdkCfg.staticPath,
        template: liveMode === "live" ? "simple" : "pcRec",
        plugin: [],
        header: liveMode === "live" ? ["capture"] : [],
        audio: 0,
        width: playerW,
        height: playerH,
        handleError: (info: unknown) => {
          if (cancelled || mySession !== playerSessionRef.current) return;
          if (hikPlayerContainerHasVideo(containerEl)) {
            markPlaying(containerEl);
            return;
          }
          hikLiveLog("PLAY FAILED", sanitizeHikSdkInfo(info));
          setUiState("ERROR");
          setErrorCode("PLAY_FAILED");
          setHikvisionPlayerPhase("PLAY_ERROR");
          setHikvisionPlayerError("PLAY_FAILED");
        },
        handleSuccess: (info: unknown) => {
          if (cancelled || mySession !== playerSessionRef.current) return;
          playSuccessRef.current = true;
          if (playerPlayTimer) {
            clearTimeout(playerPlayTimer);
            playerPlayTimer = null;
          }
          hikLiveLog("PLAY SUCCESS", sanitizeHikSdkInfo(info));
          setHikvisionLivePipelineStage("PLAY_SUCCESS");
          setHikvisionLivePipelineStage("STREAM_CONNECTED");
          setUiState("WAITING_FIRST_FRAME");
          resizePlayerToContainer(containerEl, playerRef.current);
          firstFrameTimer = window.setTimeout(() => {
            if (!playingConfirmedRef.current) failNoFirstFrame(containerEl);
          }, FIRST_FRAME_TIMEOUT_MS);
          markPlaying(containerEl);
        },
      };
      if (domain) {
        playerOpts.env = { domain };
      }

      try {
        bumpHikvisionPlayerCreateCount();
        const player = new EZUIKitPlayer(playerOpts) as PlayerInstance;
        if (mySession !== playerSessionRef.current) {
          try {
            player.destroy?.();
            player.stop();
          } catch {
            /* stale session */
          }
          initInFlightRef.current = false;
          return;
        }
        playerRef.current = player;
        initStreamKeyRef.current = streamKey;
        setHikvisionPlayerPhase("PLAYER_CREATED");
        setHikvisionLivePipelineStage("PLAYER_CREATED");
        hikLiveLog("PLAYER CREATED");
        setUiState("CONNECTING");

        playerPlayTimer = window.setTimeout(() => {
          if (!playSuccessRef.current && !playingConfirmedRef.current) {
            failPlayerPlayTimeout();
          }
        }, PLAYER_PLAY_TIMEOUT_MS);

        const sdkEvents = [
          "play",
          "firstFrame",
          "firstframe",
          "decodeStart",
          "streamSuccess",
          "streamStart",
        ] as const;
        for (const ev of sdkEvents) {
          player.on?.(ev, () => {
            if (mySession !== playerSessionRef.current) return;
            if (ev === "decodeStart") {
              setHikvisionLivePipelineStage("DECODER_STARTED");
              hikLiveLog("DECODER_STARTED");
            }
            if (ev === "streamSuccess" || ev === "streamStart") {
              setHikvisionLivePipelineStage("STREAM_CONNECTED");
            }
            if (ev === "firstFrame" || ev === "firstframe") {
              hikLiveLog("FIRST FRAME (sdk event)");
            }
            resizePlayerToContainer(containerEl, player);
            markPlaying(containerEl);
          });
        }

        stopFrameWatch = watchHikPlayerFirstFrame(containerEl, () => {
          hikLiveLog("FIRST FRAME (dom)");
          resizePlayerToContainer(containerEl, player);
          markPlaying(containerEl);
        });

        requestAnimationFrame(() => resizePlayerToContainer(containerEl, player));
        try {
          await requestEzUIKitPlay(player);
        } catch {
          if (!playSuccessRef.current && !playingConfirmedRef.current) {
            failPlayerPlayTimeout();
          }
        }
      } catch (e) {
        hikLiveLog("PLAYER CREATE FAILED", {
          message: e instanceof Error ? e.message : String(e),
        });
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
      initInFlightRef.current = false;
      stopFrameWatch?.();
      if (playerPlayTimer) clearTimeout(playerPlayTimer);
      if (firstFrameTimer) clearTimeout(firstFrameTimer);
    };
  }, [streamKey, sdkReady, online, streamErrorCode, containerId, cameraName]);

  useEffect(() => {
    playSuccessRef.current = false;
    playingConfirmedRef.current = false;
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

  useEffect(() => {
    return () => {
      destroyHikPlayer(playerRef);
      initStreamKeyRef.current = null;
    };
  }, [containerId]);

  useEffect(() => {
    const el = playerContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      resizePlayerToContainer(el, playerRef.current);
    });
    ro.observe(el);
    const onOrient = () => resizePlayerToContainer(el, playerRef.current);
    window.addEventListener("orientationchange", onOrient);
    window.addEventListener("resize", onOrient);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", onOrient);
      window.removeEventListener("resize", onOrient);
    };
  }, [streamKey, uiState]);

  const loadingLabel =
    uiState === "LOADING_SDK"
      ? "Načítám přehrávač…"
      : uiState === "LOADING_STREAM"
        ? "Připojuji živý obraz…"
        : uiState === "INITIALIZING_PLAYER"
          ? "Načítám přehrávač…"
          : uiState === "CONNECTING"
            ? "Připojuji živý obraz…"
            : uiState === "WAITING_FIRST_FRAME"
              ? "Čekám na první snímek…"
              : "Připojuji živý obraz…";

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
      uiState === "CONNECTING" ||
      uiState === "WAITING_FIRST_FRAME") &&
    !showErrorOverlay;

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative flex flex-col bg-black text-white overflow-hidden",
        mobileFit && !fsActive && "hik-ezopen-shell--mobile-fit",
        fsActive ? "w-screen h-screen rounded-none" : "rounded-md",
        className
      )}
      style={
        mobileFit && !fsActive
          ? {
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }
          : undefined
      }
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 bg-black/80 text-xs z-10 shrink-0",
          fsActive && "absolute top-0 left-0 right-0 pt-[max(0.5rem,env(safe-area-inset-top))]"
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
          "hik-ezopen-viewport",
          fsActive
            ? "hik-ezopen-viewport--fullscreen flex-1 min-h-0"
            : mobileFit && !compact
              ? "hik-ezopen-viewport--mobile"
              : compact
                ? "min-h-[180px] flex-1"
                : "hik-ezopen-viewport--desktop"
        )}
      >
        <div
          ref={playerContainerRef}
          id={containerId}
          className="hik-ezopen-player-host z-0"
        />
        {showLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 z-10">
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
