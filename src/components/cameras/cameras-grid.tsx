"use client";

import React, { useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, PlayCircle, History, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatChatTimestampDisplay } from "@/lib/format-chat-timestamp";
import type { PortalCameraRow } from "@/components/cameras/portal-cameras-hub";
import { CameraLiveDialog } from "@/components/cameras/camera-stream-dialog";
import { CameraPlaybackDialog } from "@/components/cameras/camera-playback-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SNAPSHOT_INTERVAL_MS = 20_000;

function onlineBadgeClass(online: boolean | undefined) {
  if (online === true) return "bg-green-600";
  if (online === false) return "bg-slate-600";
  return "bg-amber-600";
}

function onlineLabel(online: boolean | undefined) {
  if (online === true) return "Online";
  if (online === false) return "Offline";
  return "Neznámý";
}

function CameraSnapshot({
  companyId,
  cameraId,
  alt,
  className,
  refreshKey,
  onUpdated,
}: {
  companyId: string;
  cameraId: string;
  alt: string;
  className?: string;
  refreshKey: number;
  onUpdated: (at: Date) => void;
}) {
  const { user } = useUser();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const lastSrcRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/hikvision/cameras/${encodeURIComponent(cameraId)}/snapshot?companyId=${encodeURIComponent(companyId)}&t=${Date.now()}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          if (lastSrcRef.current) URL.revokeObjectURL(lastSrcRef.current);
          lastSrcRef.current = objectUrl;
          setSrc(objectUrl);
          setFailed(false);
          onUpdated(new Date());
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl && objectUrl !== lastSrcRef.current) URL.revokeObjectURL(objectUrl);
    };
  }, [user, companyId, cameraId, refreshKey, onUpdated]);

  if (failed && src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className={cn(className, "opacity-80")} />
    );
  }
  if (failed) {
    return (
      <div className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}>
        Náhled nedostupný
      </div>
    );
  }
  if (!src) {
    return <div className={cn("animate-pulse bg-muted", className)} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} />
  );
}

export function CamerasGrid({
  companyId,
  cameras,
  onReload,
  canLive = true,
  canPlayback = false,
}: {
  companyId: string;
  cameras: PortalCameraRow[];
  onReload?: () => void;
  canLive?: boolean;
  canPlayback?: boolean;
}) {
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Record<string, string>>({});
  const [liveCam, setLiveCam] = useState<PortalCameraRow | null>(null);
  const liveCamOpenRef = React.useRef(false);
  liveCamOpenRef.current = liveCam != null;
  const [playbackCam, setPlaybackCam] = useState<PortalCameraRow | null>(null);
  const [detailCam, setDetailCam] = useState<PortalCameraRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);
  const { user } = useUser();

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && !liveCamOpenRef.current) {
        setTick((t) => t + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible" || liveCamOpenRef.current) return;
      setTick((t) => t + 1);
    }, SNAPSHOT_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!detailCam || !user) return;
    setDetailLoading(true);
    void (async () => {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/hikvision/cameras/${encodeURIComponent(detailCam.id)}?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      setDetailData(data.ok ? data : null);
      setDetailLoading(false);
    })();
  }, [detailCam, user, companyId]);

  if (cameras.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Zatím žádné kamery. V Nastavení → Integrace → Hikvision otestujte připojení a spusťte
          „Synchronizovat kamery“.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cameras.map((cam) => (
          <Card
            key={cam.id}
            className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setDetailCam(cam)}
          >
            <div className="aspect-video bg-muted relative">
              <CameraSnapshot
                companyId={companyId}
                cameraId={cam.id}
                alt={cam.name}
                className="w-full h-full object-cover"
                refreshKey={tick}
                onUpdated={(d) =>
                  setUpdatedAt((m) => ({
                    ...m,
                    [cam.id]: d.toLocaleTimeString("cs-CZ", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }),
                  }))
                }
              />
              <Badge className={cn("absolute top-2 right-2", onlineBadgeClass(cam.online))}>
                {onlineLabel(cam.online)}
              </Badge>
            </div>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{cam.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Kanál {cam.channelId}
                {updatedAt[cam.id] ? ` · Náhled aktualizován ${updatedAt[cam.id]}` : ""}
                {!updatedAt[cam.id] && cam.lastCheckedAt
                  ? ` · ${formatChatTimestampDisplay(cam.lastCheckedAt)}`
                  : ""}
              </p>
            </CardHeader>
            <CardFooter
              className="gap-2 pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                size="sm"
                variant="default"
                disabled={!canLive}
                onClick={() => setLiveCam(cam)}
              >
                <PlayCircle className="h-4 w-4 mr-1" /> Živý obraz
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canPlayback}
                onClick={() => setPlaybackCam(cam)}
              >
                <History className="h-4 w-4 mr-1" /> Záznam
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <CameraLiveDialog
        open={liveCam != null}
        onOpenChange={(o) => !o && setLiveCam(null)}
        companyId={companyId}
        camera={liveCam}
      />
      <CameraPlaybackDialog
        open={playbackCam != null}
        onOpenChange={(o) => !o && setPlaybackCam(null)}
        companyId={companyId}
        camera={playbackCam}
      />

      <Dialog open={detailCam != null} onOpenChange={(o) => !o && setDetailCam(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailCam?.name}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex gap-2 text-muted-foreground py-6 justify-center">
              <Loader2 className="h-5 w-5 animate-spin" /> Načítání…
            </div>
          ) : detailData?.camera ? (
            <div className="space-y-3 text-sm">
              <p>
                Stav:{" "}
                <Badge className={onlineBadgeClass((detailData.camera as { online?: boolean }).online)}>
                  {onlineLabel((detailData.camera as { online?: boolean }).online)}
                </Badge>
              </p>
              <p className="text-muted-foreground">
                Kanál {(detailData.camera as { channelId?: string }).channelId} · NVR / zařízení:{" "}
                {(detailData.camera as { deviceName?: string }).deviceName ?? "—"}
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" disabled={!canLive} onClick={() => detailCam && setLiveCam(detailCam)}>
                  Živý obraz
                </Button>
                <Button size="sm" variant="outline" disabled={!canPlayback} onClick={() => detailCam && setPlaybackCam(detailCam)}>
                  Záznam
                </Button>
                <Button size="sm" variant="outline" onClick={() => onReload?.()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Aktualizovat
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Detail kamery nelze načíst.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
