"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PLATFORM_NAME } from "@/lib/platform-brand";

export type LogoProps = {
  /** Plné logo | kompaktní | pouze ikona */
  variant?: "full" | "small" | "icon";
  /** Zkrácená varianta (stejné jako variant="small") */
  small?: boolean;
  /**
   * sidebar — tmavý postranní panel portálu/adminu
   * page — přihlášení / registrace (tmavé theme pozadí)
   * light — světlý header (např. admin přihlášení, horní lišta)
   */
  context?: "sidebar" | "page" | "light";
  className?: string;
};

/**
 * Globální logo platformy RAJMONDATA (SVG, bez externích obrázků).
 * Nepoužívat jako logo konkrétní firmy.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="40" height="40" rx="11" className="fill-primary" />
      <path
        fill="hsl(var(--primary-foreground))"
        d="M10.5 29.5V10.5h8.6c5.4 0 8.9 2.9 8.9 7.6 0 3.1-1.4 5.6-4.2 6.8l4.8 4.6H22l-4.2-4H15v4h-4.5zm4.5-8.7h3.8c2.7 0 4.2-1.2 4.2-3.4s-1.5-3.4-4.2-3.4H15v6.8z"
      />
    </svg>
  );
}

function wordmarkClass(context: LogoProps["context"], part: "brand" | "suffix") {
  const c = context ?? "sidebar";
  if (part === "brand") {
    if (c === "sidebar") return "text-sidebar-primary";
    if (c === "light") return "text-primary";
    return "text-primary";
  }
  if (c === "sidebar") return "text-sidebar-foreground/80";
  if (c === "light") return "text-slate-800";
  return "text-foreground/75";
}

export function Logo({
  variant = "full",
  small = false,
  context = "sidebar",
  className,
}: LogoProps) {
  const v = small ? "small" : variant;

  if (v === "icon") {
    return (
      <div
        className={cn("inline-flex items-center justify-center", className)}
        aria-label={PLATFORM_NAME}
      >
        <LogoMark className="h-9 w-9" />
      </div>
    );
  }

  if (v === "small") {
    return (
      <div
        className={cn("inline-flex items-center gap-2 min-w-0", className)}
        aria-label={PLATFORM_NAME}
      >
        <LogoMark className="h-8 w-8" />
        <span
          className={cn(
            "font-extrabold tracking-tight text-base truncate",
            wordmarkClass(context, "brand")
          )}
        >
          RAJMON
          <span className={cn("font-semibold", wordmarkClass(context, "suffix"))}>
            DATA
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn("inline-flex items-center gap-2.5 min-w-0", className)}
      aria-label={PLATFORM_NAME}
    >
      <LogoMark className="h-9 w-9 sm:h-10 sm:w-10" />
      <span
        className={cn(
          "font-extrabold tracking-tight text-lg sm:text-xl truncate",
          wordmarkClass(context, "brand")
        )}
      >
        RAJMON
        <span className={cn("font-semibold", wordmarkClass(context, "suffix"))}>
          DATA
        </span>
      </span>
    </div>
  );
}
