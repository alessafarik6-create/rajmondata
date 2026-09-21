"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlatformAiBranding } from "@/contexts/platform-ai-branding-context";

const SIZE: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "h-10 w-10 min-h-10 min-w-10",
  sm: "h-14 w-14 min-h-14 min-w-14",
  md: "h-20 w-20 min-h-20 min-w-20",
  lg: "h-28 w-28 min-h-28 min-w-28",
};

export function AiAssistantAvatar(props: {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** Volitelný override (admin preview). */
  src?: string | null;
  alt?: string;
}) {
  const { size = "md", className, src, alt } = props;
  const { branding } = usePlatformAiBranding();
  const [imgFailed, setImgFailed] = useState(false);
  const dim = SIZE[size];
  const avatarSrc = src ?? branding.avatarUrl;
  const avatarAlt = alt ?? branding.assistantName;

  useEffect(() => {
    setImgFailed(false);
  }, [avatarSrc]);

  if (avatarSrc && !imgFailed) {
    return (
      <div
        className={cn(
          "relative rounded-full overflow-hidden ring-2 ring-orange-200 bg-muted shrink-0",
          dim,
          className
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarSrc}
          alt={avatarAlt}
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-orange-100 flex items-center justify-center text-orange-700 shrink-0 ring-2 ring-orange-200",
        dim,
        className
      )}
      aria-label={avatarAlt}
    >
      <Sparkles
        className={
          size === "xs"
            ? "h-5 w-5"
            : size === "sm"
              ? "h-6 w-6"
              : size === "md"
                ? "h-9 w-9"
                : "h-12 w-12"
        }
      />
    </div>
  );
}
