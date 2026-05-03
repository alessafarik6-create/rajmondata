"use client";

import React from "react";
import { cn } from "@/lib/utils";

type ProductionIssuePanelShellProps = {
  className?: string;
  children: React.ReactNode;
};

/**
 * Vizuální obal karty „Výdej ve výrobě“ (bez vlastního výškového resize — ten je uvnitř dílny).
 */
export function ProductionIssuePanelShell({ className, children }: ProductionIssuePanelShellProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50/40 shadow-sm",
        "max-lg:border-slate-700 max-lg:bg-slate-900/50 max-lg:shadow-lg",
        className
      )}
    >
      {children}
    </div>
  );
}
