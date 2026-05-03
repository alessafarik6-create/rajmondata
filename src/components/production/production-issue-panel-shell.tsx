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
        className
      )}
    >
      {children}
    </div>
  );
}
