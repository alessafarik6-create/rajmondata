"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Abstrakce přehrávače — napojení na Hikvision SDK / HLS / WebRTC až s OpenAPI spec. */
export function HikvisionPlayer(props: {
  state: "connecting" | "live" | "offline" | "error";
  message?: string;
  streamUrl?: string;
  onRetry?: () => void;
}) {
  const { state, message, streamUrl, onRetry } = props;

  if (state === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 min-h-[200px] text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p>Připojuji…</p>
      </div>
    );
  }

  if (state === "live" && streamUrl) {
    return (
      <video
        className="w-full h-full object-contain bg-black"
        src={streamUrl}
        controls
        playsInline
        autoPlay
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-[200px] p-4 text-center">
      <p className="text-sm text-muted-foreground">
        {state === "offline"
          ? "Offline"
          : message ?? "Live view přes Hik-Connect OpenAPI bude dostupné po doplnění oficiální specifikace streamu."}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Zkusit znovu
        </Button>
      ) : null}
    </div>
  );
}
