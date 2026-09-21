"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlatformAiBranding } from "@/contexts/platform-ai-branding-context";

const SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "h-12 w-12 min-h-12 min-w-12",
  md: "h-20 w-20 min-h-20 min-w-20",
  lg: "h-28 w-28 min-h-28 min-w-28",
};

export function AiAssistantAvatar(props: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { size = "md", className } = props;
  const { branding } = usePlatformAiBranding();
  const dim = SIZE[size];

  if (branding.avatarUrl) {
    return (
      <div
        className={cn(
          "relative rounded-full overflow-hidden ring-2 ring-primary/30 bg-muted shrink-0",
          dim,
          className
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={branding.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white shrink-0 ring-2 ring-primary/20",
        dim,
        className
      )}
    >
      <Sparkles className={size === "sm" ? "h-6 w-6" : size === "md" ? "h-9 w-9" : "h-12 w-12"} />
    </div>
  );
}
