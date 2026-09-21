"use client";

import React, { useCallback, useState } from "react";
import { useUser } from "@/firebase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HikvisionEzopenPlayer, type EzopenSession } from "@/components/cameras/hikvision-ezopen-player";
import { useIsMobile } from "@/hooks/use-mobile";

type CameraRow = { id: string; name: string; online: boolean };

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
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !camera) return;
    setLoading(true);
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
        return;
      }
      setSession({
        ezopenUrl: String(data.ezopenUrl ?? data.url ?? ""),
        accessToken: String(data.accessToken ?? ""),
        appKey: data.appKey,
        streamAreaDomain: data.streamAreaDomain,
      });
    } finally {
      setLoading(false);
    }
  }, [user, camera, companyId]);

  React.useEffect(() => {
    if (open && camera) {
      setSession(null);
      void load();
    } else {
      setSession(null);
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
          session={loading ? null : session}
          cameraName={camera.name}
          online={camera.online}
          mode="live"
          className={isMobile ? "h-[100dvh] rounded-none" : "min-h-[420px]"}
          onClose={() => onOpenChange(false)}
          onRetry={() => void load()}
        />
      </DialogContent>
    </Dialog>
  );
}
