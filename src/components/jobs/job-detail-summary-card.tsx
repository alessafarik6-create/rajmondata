"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";

export function JobDetailSummaryCard(props: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  lines?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const { title, icon, lines, actions, className, onOpen, openLabel = "Zobrazit" } = props;
  return (
    <div className={cn(JD.dashCard, className)}>
      <div className="flex items-start gap-2">
        {icon ? (
          <span className="mt-0.5 shrink-0 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className={JD.dashCardTitle}>{title}</p>
          {lines ? <div className="space-y-0.5 text-[13px] leading-snug text-gray-800">{lines}</div> : null}
        </div>
      </div>
      {(actions || onOpen) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
          {actions}
          {onOpen ? (
            <button
              type="button"
              className="text-xs font-semibold text-primary hover:underline"
              onClick={onOpen}
            >
              {openLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
