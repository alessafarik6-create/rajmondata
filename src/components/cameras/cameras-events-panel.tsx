"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CameraPlaybackDialog } from "@/components/cameras/camera-playback-dialog";

type EventRow = {
  id: string;
  cameraId: string | null;
  cameraName: string | null;
  type: string;
  title: string;
  occurredAt: string;
  acknowledged: boolean;
};

type CameraRow = { id: string; name: string; online: boolean };

export function CamerasEventsPanel(props: {
  companyId: string;
  cameras: CameraRow[];
  canPlayback: boolean;
}) {
  const { companyId, cameras, canPlayback } = props;
  const { user } = useUser();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cameraFilter, setCameraFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [playbackCamera, setPlaybackCamera] = useState<CameraRow | null>(null);
  const [playbackRange, setPlaybackRange] = useState<{ start: Date; end: Date } | undefined>();

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const q = new URLSearchParams({ companyId });
      if (cameraFilter !== "all") q.set("cameraId", cameraFilter);
      if (unreadOnly) q.set("unread", "1");
      const res = await fetch(`/api/company/hikvision/events?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) setEvents(data.events ?? []);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, cameraFilter, unreadOnly]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && events.length === 0) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Načítání událostí…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[180px]">
          <Label className="text-xs">Kamera</Label>
          <Select value={cameraFilter} onValueChange={setCameraFilter}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Vše</SelectItem>
              {cameras.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="unread" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          <Label htmlFor="unread">Nepřečtené</Label>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Dnes zatím žádné události.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {events.map((ev) => {
            const when = ev.occurredAt
              ? format(new Date(ev.occurredAt), "HH:mm", { locale: cs })
              : "—";
            return (
              <li key={ev.id} className="p-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {when} · {ev.cameraName ?? "Kamera"}
                  </p>
                  <p className="text-sm text-muted-foreground">{ev.title}</p>
                </div>
                {canPlayback && ev.cameraId && ev.occurredAt ? (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => {
                      const t = new Date(ev.occurredAt);
                      const cam = cameras.find((c) => c.id === ev.cameraId);
                      if (!cam) return;
                      setPlaybackCamera(cam);
                      setPlaybackRange({
                        start: new Date(t.getTime() - 30_000),
                        end: new Date(t.getTime() + 30_000),
                      });
                    }}
                  >
                    Přehrát záznam
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <CameraPlaybackDialog
        open={playbackCamera != null}
        onOpenChange={(o) => {
          if (!o) {
            setPlaybackCamera(null);
            setPlaybackRange(undefined);
          }
        }}
        companyId={companyId}
        camera={playbackCamera}
        initialRange={playbackRange}
      />
    </div>
  );
}
