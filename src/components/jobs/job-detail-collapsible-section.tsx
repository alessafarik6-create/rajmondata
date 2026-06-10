"use client";

import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function JobDetailCollapsibleSection(props: {
  id: string;
  title: string;
  summary?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  children: React.ReactNode;
}) {
  const {
    id,
    title,
    summary,
    open,
    onOpenChange,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
    children,
  } = props;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0">
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm",
          open && "ring-1 ring-gray-200/80"
        )}
      >
        <div className="flex items-stretch gap-1 border-b border-transparent sm:gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              id={`job-section-trigger-${id}`}
              aria-controls={`job-section-panel-${id}`}
              aria-expanded={open}
              className={cn(
                "flex min-h-12 flex-1 items-center gap-2 px-3 py-3 text-left transition-colors",
                "hover:bg-gray-50/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                "max-lg:min-h-14 max-lg:px-4 max-lg:py-4",
                open && "border-b border-gray-200 bg-gray-50/50"
              )}
            >
              <ChevronDown
                className={cn(
                  "h-5 w-5 shrink-0 text-gray-600 transition-transform duration-200",
                  open && "rotate-180"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold tracking-tight text-gray-950 sm:text-[15px]">
                  {title}
                </span>
                {!open && summary != null && summary !== "" ? (
                  <span className="mt-0.5 block truncate text-sm text-gray-600">{summary}</span>
                ) : null}
              </span>
            </button>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-0.5 pr-1 sm:pr-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-gray-600 hover:text-gray-950 max-lg:h-11 max-lg:w-11"
              disabled={!canMoveUp}
              aria-label={`Posunout sekci „${title}“ nahoru`}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-gray-600 hover:text-gray-950 max-lg:h-11 max-lg:w-11"
              disabled={!canMoveDown}
              aria-label={`Posunout sekci „${title}“ dolů`}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CollapsibleContent id={`job-section-panel-${id}`}>
          <div className="job-detail-collapsible-body px-2 py-3 sm:px-3 sm:py-4">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
