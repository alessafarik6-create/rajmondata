"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistantActivity } from "@/lib/ai/assistant/assistant-activity-types";

type Props = {
  activity: AssistantActivity;
  voiceActive?: boolean;
  wakeLockHeld?: boolean;
  wakeLockSupported?: boolean;
};

function stateDot(state: AssistantActivity["state"]) {
  if (state === "error") return "bg-destructive";
  if (state === "listening") return "bg-emerald-500 animate-pulse";
  if (state === "waiting_for_confirmation") return "bg-amber-500";
  if (state === "idle" || state === "done") return "bg-muted-foreground/40";
  return "bg-orange-500 animate-pulse";
}

export function AssistantActivityPanel({
  activity,
  voiceActive,
  wakeLockHeld,
  wakeLockSupported,
}: Props) {
  const show =
    voiceActive ||
    (activity.state !== "idle" && activity.state !== "done" && Boolean(activity.label));

  if (!show) return null;

  return (
    <div
      className={cn(
        "fixed z-[75] max-w-[min(100vw-1rem,22rem)] rounded-xl border border-orange-200/80 bg-background/95 shadow-lg backdrop-blur-sm",
        "left-3 right-3 mx-auto bottom-[calc(var(--mobile-bottom-nav-height,72px)+env(safe-area-inset-bottom,0px)+0.75rem)]",
        "md:left-auto md:right-4 md:bottom-4 md:mx-0",
        "pt-[env(safe-area-inset-top,0px)] pointer-events-none"
      )}
      aria-live="polite"
    >
      <div className="px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-orange-800">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          AI asistentka
        </div>
        {activity.label ? (
          <p className="flex items-start gap-2 text-sm text-foreground">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", stateDot(activity.state))} />
            <span>{activity.label}</span>
          </p>
        ) : null}
        {voiceActive ? (
          <p className="text-[11px] text-muted-foreground pl-4">
            🎙 Hlasový režim aktivní
            {wakeLockSupported && wakeLockHeld
              ? " · displej zůstane zapnutý"
              : wakeLockSupported === false
                ? " · uspání displeje nelze zabránit"
                : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
