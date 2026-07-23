"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { getJobStatusConfig } from "@/lib/job-status";

type JobStatusBadgeProps = {
  status: string | undefined | null;
  /** Kompaktní varianta pro mobilní karty. */
  compact?: boolean;
  /** Tmavé pozadí (mobilní seznam). */
  dark?: boolean;
  className?: string;
};

const DARK_BADGE_CLASSES: Record<string, string> = {
  nová: "border-blue-400 bg-blue-950/70 text-blue-100",
  rozpracovaná: "border-orange-400 bg-orange-950/60 text-orange-100",
  čeká: "border-amber-400 bg-amber-950/50 text-amber-100",
  pozastavená: "border-slate-400 bg-slate-800/90 text-slate-100",
  dokončená: "border-emerald-400 bg-emerald-950/60 text-emerald-100",
  fakturována: "border-emerald-500 bg-emerald-900/70 text-emerald-100",
  zrušená: "border-red-400 bg-red-950/60 text-red-100",
};

export function JobStatusBadge({
  status,
  compact = false,
  dark = false,
  className,
}: JobStatusBadgeProps) {
  const cfg = getJobStatusConfig(status);
  const Icon = cfg.icon;
  const darkCls =
    DARK_BADGE_CLASSES[String(cfg.value)] ??
    "border-white/25 bg-slate-800 text-slate-100";

  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border font-semibold leading-tight",
        compact ? "px-2 py-0.5 text-[12px]" : "px-2.5 py-1 text-[13px]",
        dark ? darkCls : cfg.badgeClassName,
        className
      )}
      title={cfg.label}
    >
      <Icon
        className={cn("shrink-0", compact ? "h-3 w-3" : "h-3.5 w-3.5")}
        aria-hidden
      />
      <span className="truncate">{cfg.label}</span>
    </span>
  );
}

export function jobStatusRowClassName(status: string | undefined | null): string {
  return getJobStatusConfig(status).rowClassName ?? "";
}
