"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pause, Play } from "lucide-react";

export type RoutePlayPoint = {
  lat: number;
  lng: number;
  recordedAt?: string | null;
};

export function FleetTripRoutePlayer({
  points,
  onIndexChange,
}: {
  points: RoutePlayPoint[];
  onIndexChange: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(2);

  const max = Math.max(0, points.length - 1);

  useEffect(() => {
    onIndexChange(index);
  }, [index, onIndexChange]);

  useEffect(() => {
    if (!playing || points.length < 2) return;
    const ms = 400 / speed;
    const t = window.setInterval(() => {
      setIndex((i) => {
        if (i >= max) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, ms);
    return () => window.clearInterval(t);
  }, [playing, speed, max, points.length]);

  const timeLabel = useMemo(() => {
    const p = points[index];
    if (!p?.recordedAt) return `Bod ${index + 1} / ${points.length}`;
    return new Date(p.recordedAt).toLocaleString("cs-CZ");
  }, [points, index]);

  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Pro přehrání trasy nejsou k dispozici časové GPS body — zobrazena je pouze statická trasa z providera.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? "Pozastavit" : "Spustit"}
        </Button>
        {[1, 2, 4].map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={speed === s ? "default" : "ghost"}
            onClick={() => setSpeed(s as 1 | 2 | 4)}
          >
            {s}×
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{timeLabel}</span>
      </div>
      <Slider
        value={[index]}
        min={0}
        max={max}
        step={1}
        onValueChange={(v) => {
          setPlaying(false);
          setIndex(v[0] ?? 0);
        }}
      />
    </div>
  );
}
