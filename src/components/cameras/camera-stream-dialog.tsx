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
  setHikvisionLiveStreamContext,
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
  const streamVariantRef = useRef<"main" | "sub" | undefined>(undefined);
  const subCandidateIndexRef = useRef<number | undefined>(undefined);

  const fetchLiveConfig = useCallback(
    async (
      reason: "open" | "retry" | "substream" | "sub_candidate",
      streamVariant?: "main" | "sub",
      subCandidateIndex?: number
    ) => {
      if (!user || !cameraId) return;
      if (reason === "open" || reason === "retry") {
        streamVariantRef.current = undefined;
        subCandidateIndexRef.current = undefined;
      }
      if (streamVariant) streamVariantRef.current = streamVariant;
      if (typeof subCandidateIndex === "number" && subCandidateIndex >= 0) {
        subCandidateIndexRef.current = Math.floor(subCandidateIndex);
      }
      if (reason === "sub_candidate") {
        subCandidateIndexRef.current = (subCandidateIndexRef.current ?? 0) + 1;
        streamVariantRef.current = "sub";
      }
      const gen = ++fetchGenRef.current;
      bumpHikvisionLiveConfigFetchCount();
      hikLiveLog("CONFIG FETCH", {
        reason,
        camera: cameraId,
        streamVariant: streamVariantRef.current,
        subCandidateIndex: subCandidateIndexRef.current,
      });
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
            body: JSON.stringify({
              companyId,
              ...(streamVariantRef.current
                ? { streamVariant: streamVariantRef.current }
                : {}),
              ...(subCandidateIndexRef.current != null
                ? { subCandidateIndex: subCandidateIndexRef.current }
                : {}),
            }),
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
          expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
          streamVariant: data.streamVariant === "sub" ? "sub" : "main",
          deviceSerialMasked: data.deviceSerialMasked,
          channelNo: data.channelNo,
          streamType: data.streamType,
          protocol: data.protocol,
          codecHint: data.codecHint,
          mainStream: data.mainStream,
          subStream: data.subStream ?? null,
          webLiveSelectionReason: data.webLiveSelectionReason,
          subCandidateIndex: data.subCandidateIndex,
          webLiveWarning: data.webLiveWarning ?? null,
        });
        setStreamErrorCode(null);
        setHikvisionPlayerStreamMeta({
          streamUrlPresent: Boolean(data.streamUrlPresent ?? data.ezopenUrl ?? data.url),
          expiresAt: data.expiresAt ? String(data.expiresAt) : null,
          tokenPresent: Boolean(data.accessTokenPresent ?? data.accessToken),
        });
        setHikvisionLiveStreamContext({
          cameraId,
          deviceSerialMasked: data.deviceSerialMasked,
          channelNo: data.channelNo,
          streamType: data.streamType,
          streamVariant: data.streamVariant === "sub" ? "sub" : "main",
          protocol: data.protocol ?? "ezopen",
          codecHint: data.codecHint ?? "unknown",
          mainStreamCodec: data.mainStream?.codec,
          subStreamCodec: data.subStream?.codec,
          webLiveSelectionReason: data.webLiveSelectionReason ?? null,
          webLiveWarning: data.webLiveWarning ?? null,
          tokenPresent: Boolean(data.accessTokenPresent ?? data.accessToken),
          urlPresent: Boolean(data.streamUrlPresent ?? data.ezopenUrl ?? data.url),
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

  const handleSubStreamFallback = useCallback(() => {
    void fetchLiveConfig("substream", "sub");
  }, [fetchLiveConfig]);

  const handleSubStreamCandidateFallback = useCallback(() => {
    void fetchLiveConfig("sub_candidate", "sub");
  }, [fetchLiveConfig]);

  if (!camera || !cameraId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "max-w-none w-screen max-h-[100dvh] h-full p-0 gap-0 rounded-none border-0 flex flex-col overflow-hidden"
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
          className={isMobile ? "flex-1 min-h-0 w-full rounded-none" : "w-full"}
          mobileLayout={isMobile}
          onClose={() => onOpenChange(false)}
          onRetry={handleRetry}
          onSubStreamFallback={handleSubStreamFallback}
          onSubStreamCandidateFallback={handleSubStreamCandidateFallback}
          showDeveloperDetail
          streamErrorCode={streamErrorCode}
        />
      </DialogContent>
    </Dialog>
  );
}
