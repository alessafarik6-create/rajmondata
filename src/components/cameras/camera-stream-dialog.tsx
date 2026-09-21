"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/firebase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HikvisionEzopenPlayer,
  type EzopenSession,
  type HikvisionLivePlayerErrorCode,
} from "@/components/cameras/hikvision-ezopen-player";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  bumpHikvisionLiveConfigFetchCount,
  hikLiveLog,
  resetHikvisionPlayerDebugCounters,
  setHikvisionPlayerStreamMeta,
} from "@/lib/hikvision/player-runtime-diagnostics";

type CameraRow = { id: string; name: string; online: boolean };

function mapStreamApiError(data: {
  code?: string;
  error?: string;
}): HikvisionLivePlayerErrorCode {
  const code = String(data.code ?? "").trim();
  if (code === "CAMERA_OFFLINE" || code === "DEVICE_OFFLINE") return "DEVICE_OFFLINE";
  if (code === "HIKVISION_TOKEN_FAILED" || code === "HIKVISION_STREAM_UNAVAILABLE")
    return "STREAM_TOKEN_FAILED";
  return "STREAM_TOKEN_FAILED";
}

export function CameraLiveDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  camera: CameraRow | null;
}) {
  const { open, onOpenChange, companyId, camera } = props;
  const cameraId = camera?.id ?? null;
  const { user } = useUser();
  const isMobile = useIsMobile();
  const [session, setSession] = useState<EzopenSession | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamErrorCode, setStreamErrorCode] = useState<HikvisionLivePlayerErrorCode | null>(null);
  const fetchGenRef = useRef(0);

  const fetchLiveConfig = useCallback(
    async (reason: "open" | "retry") => {
      if (!user || !cameraId) return;
      const gen = ++fetchGenRef.current;
      bumpHikvisionLiveConfigFetchCount();
      hikLiveLog("CONFIG FETCH", { reason, camera: cameraId });
      setLoadingStream(true);
      if (reason === "open") {
        setStreamErrorCode(null);
      }
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/hikvision/cameras/${encodeURIComponent(cameraId)}/live`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ companyId }),
          }
        );
        const data = await res.json();
        if (gen !== fetchGenRef.current) return;
        if (!res.ok || !data.ok) {
          if (reason === "open") {
            setSession(null);
          }
          setStreamErrorCode(mapStreamApiError(data));
          return;
        }
        setSession({
          ezopenUrl: String(data.ezopenUrl ?? data.url ?? ""),
          accessToken: String(data.accessToken ?? ""),
          appKey: data.appKey,
          streamAreaDomain: data.streamAreaDomain,
        });
        setStreamErrorCode(null);
        setHikvisionPlayerStreamMeta({
          streamUrlPresent: Boolean(data.streamUrlPresent ?? data.ezopenUrl ?? data.url),
          expiresAt: data.expiresAt ? String(data.expiresAt) : null,
        });
      } catch {
        if (gen !== fetchGenRef.current) return;
        if (reason === "open") setSession(null);
        setStreamErrorCode("STREAM_TOKEN_FAILED");
      } finally {
        if (gen === fetchGenRef.current) {
          setLoadingStream(false);
        }
      }
    },
    [user, cameraId, companyId]
  );

  useEffect(() => {
    if (!open || !cameraId) {
      fetchGenRef.current += 1;
      setSession(null);
      setStreamErrorCode(null);
      setLoadingStream(false);
      return;
    }
    resetHikvisionPlayerDebugCounters();
    setSession(null);
    void fetchLiveConfig("open");
  }, [open, cameraId, fetchLiveConfig]);

  const handleRetry = useCallback(() => {
    void fetchLiveConfig("retry");
  }, [fetchLiveConfig]);

  if (!camera || !cameraId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "max-w-none w-screen h-[100dvh] p-0 gap-0 rounded-none border-0"
            : "max-w-[1100px] w-[95vw] p-0 gap-0 overflow-hidden"
        }
      >
        {!isMobile ? (
          <DialogHeader className="px-4 pt-3 pb-0">
            <DialogTitle>Živý obraz — {camera.name}</DialogTitle>
          </DialogHeader>
        ) : null}
        <HikvisionEzopenPlayer
          key={cameraId}
          cameraId={cameraId}
          session={session}
          streamLoading={loadingStream && !session}
          cameraName={camera.name}
          online={camera.online}
          mode="live"
          className={isMobile ? "h-[100dvh] rounded-none" : "w-full"}
          onClose={() => onOpenChange(false)}
          onRetry={handleRetry}
          streamErrorCode={streamErrorCode}
        />
      </DialogContent>
    </Dialog>
  );
}
