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

export function JobStatusBadge({
  status,
  compact = false,
  dark = false,
  className,
}: JobStatusBadgeProps) {
  const cfg = getJobStatusConfig(status);
  const Icon = cfg.icon;

  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border font-medium",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
        cfg.badgeClassName,
        dark && cfg.filterGroup === "completed" && "border-emerald-400/40",
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
