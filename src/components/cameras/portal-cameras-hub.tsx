"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CamerasGrid } from "@/components/cameras/cameras-grid";
import { CamerasLiveGrid } from "@/components/cameras/cameras-live-grid";
import { CamerasEventsPanel } from "@/components/cameras/cameras-events-panel";
import { Loader2 } from "lucide-react";

export type PortalCameraRow = {
  id: string;
  channelId: string;
  name: string;
  online: boolean;
  trackStreamId: string;
  lastCheckedAt: string | null;
  deviceId?: string | null;
  capabilities?: { ptz?: boolean } | null;
};

export function PortalCamerasHub(props: {
  companyId: string;
  canLive: boolean;
  canPlayback: boolean;
}) {
  const { companyId, canLive, canPlayback } = props;
  const { user } = useUser();
  const [cameras, setCameras] = useState<PortalCameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

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

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" /> Načítání kamer…
      </div>
    );
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="overview">Přehled</TabsTrigger>
        <TabsTrigger value="live" disabled={!canLive}>
          Živé kamery
        </TabsTrigger>
        <TabsTrigger value="events">Události</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <CamerasGrid
          companyId={companyId}
          cameras={cameras}
          onReload={load}
          canLive={canLive}
          canPlayback={canPlayback}
        />
      </TabsContent>
      <TabsContent value="live">
        {canLive ? (
          <CamerasLiveGrid companyId={companyId} cameras={cameras} />
        ) : (
          <p className="text-sm text-muted-foreground">Nemáte oprávnění CAMERAS_LIVE.</p>
        )}
      </TabsContent>
      <TabsContent value="events">
        <CamerasEventsPanel companyId={companyId} cameras={cameras} canPlayback={canPlayback} />
      </TabsContent>
    </Tabs>
  );
}
