"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import type { SearchResultItem } from "@/lib/search/types";
import { searchEntityLabel } from "@/lib/search/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchResultFileThumbnail } from "@/components/search/search-result-file-thumbnail";
import { cn } from "@/lib/utils";

type Props = {
  results: SearchResultItem[];
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  onOpenResult?: (item: SearchResultItem) => void;
  onPreviewResult?: (item: SearchResultItem) => void;
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
  summaryText?: string | null;
};

function isPreviewableFile(item: SearchResultItem): boolean {
  const title = item.metadata.fileName ?? item.title;
  const mime = item.mimeType ?? "";
  return (
    !!item.fileUrl &&
    (item.entityType === "file" ||
      item.entityType === "document" ||
      mime.includes("pdf") ||
      mime.startsWith("image/") ||
      /\.(pdf|jpe?g|png|webp|gif)$/i.test(title))
  );
}

const ENTITY_BADGE: Record<string, string> = {
  job: "ZAKÁZKA",
  customer: "ZÁKAZNÍK",
  invoice: "FAKTURA",
  document: "DOKLAD",
  offer: "NABÍDKA",
  inquiry: "POPTÁVKA",
  product: "PRODUKT",
  file: "SOUBOR",
};

function typeBadge(item: SearchResultItem): string | null {
  const title = item.metadata.fileName ?? item.title;
  const mime = item.mimeType ?? "";
  if (mime.includes("pdf") || title.toLowerCase().endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(title)) return "OBRÁZEK";
  const cat = (item.metadata.category ?? "").toLowerCase();
  if (cat.includes("smlouv")) return "SMLOUVA";
  if (cat.includes("nabídk") || cat.includes("nabidk")) return "NABÍDKA";
  return null;
}

function entityBadgeLabel(item: SearchResultItem): string {
  return ENTITY_BADGE[item.entityType] ?? searchEntityLabel(item.entityType).toUpperCase();
}

export function SearchResultsList({
  results,
  activeIndex = -1,
  onActiveIndexChange,
  onOpenResult,
  onPreviewResult,
  loading,
  emptyMessage = "Žádné výsledky",
  compact,
  summaryText,
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
    <div className="space-y-2">
      {summaryText ? (
        <p className="text-sm text-slate-800 leading-snug px-1">{summaryText}</p>
      ) : null}
      <ul className={cn("divide-y rounded-md border", compact ? "overflow-y-auto" : "")}>
        {results.map((item, idx) => {
          const previewable = isPreviewableFile(item);
          const extraBadge = typeBadge(item);
          const jobId = item.metadata.jobId;
          const jobUrl = jobId ? `/portal/jobs/${encodeURIComponent(jobId)}` : null;
          return (
            <li key={`${item.entityType}-${item.entityId}`}>
              <div
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-3 transition-colors",
                  activeIndex === idx && "bg-muted/70"
                )}
                onMouseEnter={() => onActiveIndexChange?.(idx)}
              >
                {previewable ? (
                  <SearchResultFileThumbnail
                    fileUrl={item.fileUrl}
                    mimeType={item.mimeType}
                    title={item.metadata.fileName ?? item.title}
                  />
                ) : null}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    if (previewable && onPreviewResult) onPreviewResult(item);
                    else onOpenResult?.(item);
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {entityBadgeLabel(item)}
                    </Badge>
                    {extraBadge ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {extraBadge}
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
                </button>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  {previewable && onPreviewResult ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-9"
                      onClick={() => onPreviewResult(item)}
                    >
                      Náhled
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="sm" className="min-h-9">
                    <Link href={item.openUrl} onClick={(e) => e.stopPropagation()}>
                      Otevřít
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                  {jobUrl ? (
                    <Button asChild variant="outline" size="sm" className="min-h-9">
                      <Link href={jobUrl} onClick={(e) => e.stopPropagation()}>
                        Zakázka
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
