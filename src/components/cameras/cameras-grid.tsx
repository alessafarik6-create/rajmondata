"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, PlayCircle, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatChatTimestampDisplay } from "@/lib/format-chat-timestamp";

type CameraRow = {
  id: string;
  channelId: string;
  name: string;
  online: boolean;
  trackStreamId: string;
  lastCheckedAt: string | null;
};

function CameraSnapshot({
  companyId,
  cameraId,
  alt,
  className,
}: {
  companyId: string;
  cameraId: string;
  alt: string;
  className?: string;
}) {
  const { user } = useUser();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/hikvision/cameras/${encodeURIComponent(cameraId)}/snapshot?companyId=${encodeURIComponent(companyId)}&t=${Date.now()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user, companyId, cameraId]);

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
  canLive = true,
  canPlayback = false,
}: {
  companyId: string;
  canLive?: boolean;
  canPlayback?: boolean;
}) {
  const { user } = useUser();
  const { toast } = useToast();
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/hikvision/cameras?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (data.ok) setCameras(data.cameras ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLive(cameraId: string) {
    if (!user || !canLive) {
      toast({
        variant: "destructive",
        title: "Živý obraz",
        description: "Nemáte oprávnění CAMERAS_LIVE.",
      });
      return;
    }
    const token = await user.getIdToken();
    const res = await fetch(
      `/api/company/hikvision/cameras/${encodeURIComponent(cameraId)}/live`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const data = await res.json();
    toast({
      variant: "destructive",
      title: "Živý obraz",
      description: data.error ?? "Stream bude v další fázi (WebRTC/HLS).",
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" /> Načítání kamer…
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Zatím žádné kamery. V Nastavení → Integrace → Hikvision otestujte NVR a spusťte „Načíst kamery
          z NVR“.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="hidden md:grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cameras.map((cam) => (
          <Card key={cam.id} className="overflow-hidden">
            <div className="aspect-video bg-muted relative">
              <CameraSnapshot
                companyId={companyId}
                cameraId={cam.id}
                alt={cam.name}
                className="w-full h-full object-cover"
              />
              <Badge
                className={cn(
                  "absolute top-2 right-2",
                  cam.online ? "bg-green-600" : "bg-slate-600"
                )}
              >
                {cam.online ? "Online" : "Offline"}
              </Badge>
            </div>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{cam.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Kanál {cam.channelId}
                {cam.lastCheckedAt
                  ? ` · ${formatChatTimestampDisplay(cam.lastCheckedAt)}`
                  : ""}
              </p>
            </CardHeader>
            <CardFooter className="gap-2 pb-4">
              <Button
                size="sm"
                variant="default"
                disabled={!canLive}
                onClick={() => void onLive(cam.id)}
              >
                <PlayCircle className="h-4 w-4 mr-1" /> Živý obraz
              </Button>
              <Button size="sm" variant="outline" disabled={!canPlayback}>
                <History className="h-4 w-4 mr-1" /> Záznam
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <div className="md:hidden space-y-4 pb-8">
        {cameras.map((cam) => (
          <Card key={cam.id} className="overflow-hidden">
            <div className="aspect-video bg-muted relative">
              <CameraSnapshot
                companyId={companyId}
                cameraId={cam.id}
                alt={cam.name}
                className="w-full h-full object-cover"
              />
              <Badge
                className={cn(
                  "absolute top-2 right-2",
                  cam.online ? "bg-green-600" : "bg-slate-600"
                )}
              >
                {cam.online ? "Online" : "Offline"}
              </Badge>
            </div>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{cam.name}</CardTitle>
              <p className="text-xs text-muted-foreground">Kanál {cam.channelId}</p>
            </CardHeader>
            <CardFooter className="gap-2 pb-4">
              <Button
                size="sm"
                className="flex-1"
                disabled={!canLive}
                onClick={() => void onLive(cam.id)}
              >
                <PlayCircle className="h-4 w-4 mr-1" /> Živý obraz
              </Button>
              <Button size="sm" variant="outline" className="flex-1" disabled={!canPlayback}>
                <History className="h-4 w-4 mr-1" /> Záznam
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  );
}
