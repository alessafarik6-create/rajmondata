"use client";

import React, { useCallback, useState } from "react";
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

type CameraRow = { id: string; name: string; online: boolean };

function mapStreamApiError(data: {
  code?: string;
  error?: string;
}): HikvisionLivePlayerErrorCode {
  const code = String(data.code ?? "").trim();
  if (code === "CAMERA_OFFLINE" || code === "DEVICE_OFFLINE") return "DEVICE_OFFLINE";
  return "STREAM_TOKEN_FAILED";
}

export function CameraLiveDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  camera: CameraRow | null;
}) {
  const { open, onOpenChange, companyId, camera } = props;
  const { user } = useUser();
  const isMobile = useIsMobile();
  const [session, setSession] = useState<EzopenSession | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamErrorCode, setStreamErrorCode] = useState<HikvisionLivePlayerErrorCode | null>(null);

  const load = useCallback(async () => {
    if (!user || !camera) return;
    setLoadingStream(true);
    setStreamErrorCode(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/hikvision/cameras/${encodeURIComponent(camera.id)}/live`,
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
      if (!res.ok || !data.ok) {
        setSession(null);
        setStreamErrorCode(mapStreamApiError(data));
        return;
      }
      setSession({
        ezopenUrl: String(data.ezopenUrl ?? data.url ?? ""),
        accessToken: String(data.accessToken ?? ""),
        appKey: data.appKey,
        streamAreaDomain: data.streamAreaDomain,
      });
    } catch {
      setSession(null);
      setStreamErrorCode("STREAM_TOKEN_FAILED");
    } finally {
      setLoadingStream(false);
    }
  }, [user, camera, companyId]);

  React.useEffect(() => {
    if (open && camera) {
      setSession(null);
      setStreamErrorCode(null);
      void load();
    } else {
      setSession(null);
      setStreamErrorCode(null);
    }
  }, [open, camera, load]);

  if (!camera) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "max-w-none w-screen h-[100dvh] p-0 gap-0 rounded-none border-0"
            : "max-w-4xl w-[95vw] p-0 gap-0 overflow-hidden"
        }
      >
        {!isMobile ? (
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Živý obraz — {camera.name}</DialogTitle>
          </DialogHeader>
        ) : null}
        <HikvisionEzopenPlayer
          session={loadingStream ? null : session}
          cameraName={camera.name}
          online={camera.online}
          mode="live"
          className={isMobile ? "h-[100dvh] rounded-none" : "min-h-[420px]"}
          onClose={() => onOpenChange(false)}
          onRetry={() => void load()}
          streamErrorCode={streamErrorCode}
        />
      </DialogContent>
    </Dialog>
  );
}
