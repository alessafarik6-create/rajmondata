"use client";

import React, { useCallback, useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { cs } from "date-fns/locale";
import { useUser } from "@/firebase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HikvisionEzopenPlayer, type EzopenSession } from "@/components/cameras/hikvision-ezopen-player";

type CameraRow = { id: string; name: string; online: boolean };

function defaultDayRange(day: Date) {
  const ymd = format(day, "yyyy-MM-dd");
  return { date: ymd, from: "08:00", to: "18:00" };
}

export function CameraPlaybackDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  camera: CameraRow | null;
  initialRange?: { start: Date; end: Date };
}) {
  const { open, onOpenChange, companyId, camera, initialRange } = props;
  const { user } = useUser();
  const [day, setDay] = useState(() => defaultDayRange(new Date()));
  const [session, setSession] = useState<EzopenSession | null>(null);
  const [segments, setSegments] = useState<Array<{ start: string; end: string; source: string }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialRange && open) {
      setDay({
        date: format(initialRange.start, "yyyy-MM-dd"),
        from: format(initialRange.start, "HH:mm"),
        to: format(initialRange.end, "HH:mm"),
      });
    }
  }, [initialRange, open]);

  const search = useCallback(async () => {
    if (!user || !camera) return;
    const token = await user.getIdToken();
    const fromIso = new Date(`${day.date}T${day.from}:00`).toISOString();
    const toIso = new Date(`${day.date}T${day.to}:00`).toISOString();
    const res = await fetch(
      `/api/company/hikvision/cameras/${encodeURIComponent(camera.id)}/playback/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyId, from: fromIso, to: toIso }),
      }
    );
    const data = await res.json();
    if (data.ok) {
      setSegments(data.segments ?? []);
      setNote(data.note ?? null);
    }
  }, [user, camera, companyId, day]);

  const playRange = useCallback(async () => {
    if (!user || !camera) return;
    setLoading(true);
    setSession(null);
    try {
      const token = await user.getIdToken();
      const startTime = `${day.date} ${day.from}:00`;
      const stopTime = `${day.date} ${day.to}:00`;
      const res = await fetch(
        `/api/company/hikvision/cameras/${encodeURIComponent(camera.id)}/playback`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId,
            startTime,
            stopTime,
            source: segments[0]?.source === "cloud" ? "cloud" : "local",
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.ok) {
        setSession({
          ezopenUrl: String(data.ezopenUrl ?? data.url ?? ""),
          accessToken: String(data.accessToken ?? ""),
          appKey: data.appKey,
          streamAreaDomain: data.streamAreaDomain,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [user, camera, companyId, day, segments]);

  useEffect(() => {
    if (open && camera) {
      void search();
    } else {
      setSession(null);
    }
  }, [open, camera, search]);

  if (!camera) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Záznam kamery — {camera.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mb-3">
          <Button type="button" size="sm" variant="outline" onClick={() => setDay(defaultDayRange(new Date()))}>
            Dnes
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setDay(defaultDayRange(subDays(new Date(), 1)))}
          >
            Včera
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <Label>Datum</Label>
            <Input type="date" value={day.date} onChange={(e) => setDay((d) => ({ ...d, date: e.target.value }))} />
          </div>
          <div>
            <Label>Čas od</Label>
            <Input type="time" value={day.from} onChange={(e) => setDay((d) => ({ ...d, from: e.target.value }))} />
          </div>
          <div>
            <Label>Čas do</Label>
            <Input type="time" value={day.to} onChange={(e) => setDay((d) => ({ ...d, to: e.target.value }))} />
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Button type="button" variant="outline" onClick={() => void search()}>
            Vyhledat záznam
          </Button>
          <Button type="button" onClick={() => void playRange()} disabled={loading}>
            Přehrát interval
          </Button>
        </div>

        {note ? <p className="text-xs text-muted-foreground mb-3">{note}</p> : null}

        {segments.length > 0 ? (
          <div className="rounded-md border p-3 mb-4 text-xs text-muted-foreground">
            {format(new Date(segments[0].start), "HH:mm", { locale: cs })} ───── záznam ─────{" "}
            {format(new Date(segments[0].end), "HH:mm", { locale: cs })}
          </div>
        ) : null}

        <HikvisionEzopenPlayer
          session={loading ? null : session}
          cameraName={camera.name}
          online={camera.online}
          mode="playback"
          className="min-h-[320px]"
          onRetry={() => void playRange()}
        />
      </DialogContent>
    </Dialog>
  );
}
