"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX, Maximize, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useHikConnectJssdk } from "@/components/cameras/use-hikconnect-jssdk";

export type EzopenSession = {
  ezopenUrl: string;
  accessToken: string;
  appKey?: string;
  streamAreaDomain?: string;
};

export function HikvisionEzopenPlayer(props: {
  session: EzopenSession | null;
  cameraName: string;
  online?: boolean;
  mode: "live" | "playback";
  className?: string;
  onClose?: () => void;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { session, cameraName, online, mode, className, onClose, onRetry, compact } = props;
  const containerId = useId().replace(/:/g, "");
  const playerRef = useRef<{ stop: () => void; destroy?: () => void; openSound: () => void; closeSound: () => void; fullScreen: () => void } | null>(null);
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { ready: sdkReady, error: sdkError } = useHikConnectJssdk();

  useEffect(() => {
    if (!session?.ezopenUrl || !session.accessToken) {
      setState("idle");
      return;
    }
    if (!sdkReady) {
      setState("connecting");
      return;
    }
    const EZUIKitPlayer = window.EZUIKit?.EZUIKitPlayer;
    if (!EZUIKitPlayer) {
      setState("error");
      setErrorMsg(sdkError ?? "JSSDK není k dispozici.");
      return;
    }

    setState("connecting");
    setErrorMsg(null);
    try {
      playerRef.current?.destroy?.();
      playerRef.current?.stop();
    } catch {
      /* ignore */
    }

    try {
      const player = new EZUIKitPlayer({
        id: containerId,
        url: session.ezopenUrl,
        accessToken: session.accessToken,
        template: "simple",
        plugin: ["talk"],
        header: ["capture"],
        audio: 0,
        width: compact ? 320 : undefined,
        height: compact ? 180 : undefined,
      });
      playerRef.current = player;
      setState("live");
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : "Přehrávač selhal.");
    }

    return () => {
      try {
        playerRef.current?.destroy?.();
        playerRef.current?.stop();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [session, sdkReady, sdkError, containerId, compact]);

  const now = new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className={cn("relative flex flex-col bg-black text-white rounded-md overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-black/80 text-xs">
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
            onClick={() => playerRef.current?.fullScreen()}
          >
            <Maximize className="h-4 w-4" />
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

      <div className="relative flex-1 min-h-[200px] bg-black">
        <div id={containerId} className="w-full h-full min-h-[200px]" />
        {state === "connecting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Připojuji stream…</p>
          </div>
        ) : null}
        {state === "error" || sdkError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center bg-black/80">
            <p className="text-sm">{errorMsg ?? sdkError ?? "Živý obraz se nepodařilo načíst."}</p>
            {onRetry ? (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                Zkusit znovu
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
