"use client";

import React, { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { HikvisionEzopenPlayer, type EzopenSession } from "@/components/cameras/hikvision-ezopen-player";
import { useUser } from "@/firebase";

type CameraRow = { id: string; name: string; online: boolean };

type Layout = "1" | "2x2" | "3x3" | "4x4";

const SLOT_COUNTS: Record<Layout, number> = { "1": 1, "2x2": 4, "3x3": 9, "4x4": 16 };

function LiveTile(props: {
  companyId: string;
  cameraId: string | null;
  cameras: CameraRow[];
  onPick: (slot: number, id: string) => void;
  slot: number;
}) {
  const { companyId, cameraId, cameras, onPick, slot } = props;
  const { user } = useUser();
  const [session, setSession] = useState<EzopenSession | null>(null);
  const camera = cameras.find((c) => c.id === cameraId) ?? null;

  React.useEffect(() => {
    let cancelled = false;
    setSession(null);
    if (!cameraId || !user || !camera) return;
    void (async () => {
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
      if (cancelled || !res.ok || !data.ok) return;
      setSession({
        ezopenUrl: String(data.ezopenUrl ?? data.url ?? ""),
        accessToken: String(data.accessToken ?? ""),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraId, user, companyId]);

  return (
    <div className="border rounded-lg overflow-hidden bg-muted flex flex-col min-h-[180px]">
      <div className="p-2 border-b bg-background">
        <Select
          value={cameraId ?? ""}
          onValueChange={(v) => onPick(slot, v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Vyberte kameru" />
          </SelectTrigger>
          <SelectContent>
            {cameras.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {camera && session ? (
        <HikvisionEzopenPlayer
          cameraId={camera.id}
          session={session}
          cameraName={camera.name}
          online={camera.online}
          mode="live"
          compact
          className="flex-1 min-h-[160px]"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">
          {cameraId ? "Načítání streamu…" : "Zvolte kameru"}
        </div>
      )}
    </div>
  );
}

export function CamerasLiveGrid(props: { companyId: string; cameras: CameraRow[] }) {
  const { companyId, cameras } = props;
  const [layout, setLayout] = useState<Layout>("2x2");
  const slots = SLOT_COUNTS[layout];
  const [ picks, setPicks] = useState<Record<number, string>>({});

  const gridClass = useMemo(() => {
    switch (layout) {
      case "1":
        return "grid-cols-1";
      case "2x2":
        return "grid-cols-1 sm:grid-cols-2";
      case "3x3":
        return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
      case "4x4":
        return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
      default:
        return "grid-cols-2";
    }
  }, [layout]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["1", "2x2", "3x3", "4x4"] as Layout[]).map((l) => (
          <Button
            key={l}
            type="button"
            size="sm"
            variant={layout === l ? "default" : "outline"}
            onClick={() => setLayout(l)}
          >
            {l === "1" ? "1 kamera" : l}
          </Button>
        ))}
      </div>
      <div className={`grid gap-3 ${gridClass}`}>
        {Array.from({ length: slots }).map((_, i) => (
          <LiveTile
            key={i}
            slot={i}
            companyId={companyId}
            cameraId={picks[i] ?? null}
            cameras={cameras}
            onPick={(slot, id) => setPicks((p) => ({ ...p, [slot]: id }))}
          />
        ))}
      </div>
    </div>
  );
}
