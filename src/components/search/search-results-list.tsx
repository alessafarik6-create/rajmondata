"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import type { SearchResultItem } from "@/lib/search/types";
import { searchEntityLabel } from "@/lib/search/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  results: SearchResultItem[];
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  onOpenResult?: (item: SearchResultItem) => void;
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
};

export function SearchResultsList({
  results,
  activeIndex = -1,
  onActiveIndexChange,
  onOpenResult,
  loading,
  emptyMessage = "Žádné výsledky",
  compact,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Hledám…
      </div>
    );
  }

  if (results.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className={cn("divide-y", compact ? "max-h-[50vh] overflow-y-auto" : "")}>
      {results.map((item, idx) => {
        const isPdf = item.mimeType?.includes("pdf");
        const isImage = item.mimeType?.startsWith("image/");
        return (
          <li key={`${item.entityType}-${item.entityId}`}>
            <button
              type="button"
              className={cn(
                "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                activeIndex === idx && "bg-muted"
              )}
              onMouseEnter={() => onActiveIndexChange?.(idx)}
              onClick={() => onOpenResult?.(item)}
            >
              <div className="mt-0.5 shrink-0 text-muted-foreground">
                {isImage ? (
                  <ImageIcon className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {searchEntityLabel(item.entityType)}
                  </Badge>
                  {isPdf ? (
                    <Badge variant="secondary" className="text-[10px]">
                      PDF
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate font-medium">{item.title}</p>
                {item.subtitle ? (
                  <p className="truncate text-sm text-muted-foreground">{item.subtitle}</p>
                ) : null}
                {item.detail ? (
                  <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                ) : null}
                <p className="mt-1 text-xs text-blue-700">{item.matchDetail}</p>
              </div>
              <Button asChild variant="ghost" size="sm" className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <Link href={item.openUrl}>
                  Otevřít
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
