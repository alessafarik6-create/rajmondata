"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";

export function JobDetailDeepSection(props: {
  id: string;
  title: string;
  summary?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { id, title, summary, open, onOpenChange, children, className } = props;
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      id={`job-deep-${id}`}
      className={cn("min-w-0 scroll-mt-24", className)}
    >
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            )}
            aria-expanded={open}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-gray-600 transition-transform",
                open && "rotate-180"
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-950">{title}</span>
              {!open && summary != null && summary !== "" ? (
                <span className="mt-0.5 block truncate text-xs text-gray-600">{summary}</span>
              ) : null}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={cn(JD.deepSectionBody, "border-t border-gray-200")}>{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
