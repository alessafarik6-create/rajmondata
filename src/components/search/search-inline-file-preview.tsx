"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SearchResultItem } from "@/lib/search/types";
import { Button } from "@/components/ui/button";
import { KnowledgePagePreview } from "@/components/ai-center/knowledge-page-preview";
import { cn } from "@/lib/utils";

type Props = {
  item: SearchResultItem;
  searchQuery?: string;
  onBack: () => void;
  className?: string;
};

export function SearchInlineFilePreview({ item, searchQuery, onBack, className }: Props) {
  const fileUrl = item.fileUrl ?? null;
  const title = item.metadata.fileName ?? item.title;
  const isPdf =
    item.mimeType?.includes("pdf") || title.toLowerCase().endsWith(".pdf");
  const isImage =
    item.mimeType?.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(title);
  const jobId = item.metadata.jobId;
  const jobName = item.metadata.jobName;
  const jobUrl = jobId ? `/portal/jobs/${encodeURIComponent(jobId)}` : null;

  return (
    <div className={cn("space-y-3", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-9 gap-1 px-0 text-slate-700 hover:bg-transparent"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        Zpět na výsledky
      </Button>

      {searchQuery?.trim() ? (
        <p className="text-xs text-muted-foreground">
          Dotaz: <span className="font-medium text-slate-800">{searchQuery.trim()}</span>
        </p>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-3 shadow-sm">
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        {jobName ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Zakázka: {jobName}</p>
        ) : null}

        <div className="mx-auto mt-3 max-h-[min(58vh,520px)] overflow-auto rounded-md border bg-white p-2">
          {!fileUrl ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Náhled není k dispozici.</p>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl}
              alt={title}
              className="mx-auto max-h-[min(56vh,500px)] w-auto max-w-full object-contain"
            />
          ) : isPdf ? (
            <KnowledgePagePreview
              pdfUrl={fileUrl}
              pageNumber={1}
              compact={false}
              className="w-full min-h-[240px]"
            />
          ) : (
            <iframe
              title={title}
              src={fileUrl}
              className="h-[min(56vh,500px)] w-full rounded border-0"
            />
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {fileUrl ? (
            <Button asChild type="button" variant="default" className="min-h-10">
              <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                Otevřít dokument
              </a>
            </Button>
          ) : null}
          <Button asChild type="button" variant="outline" className="min-h-10">
            <Link href={item.openUrl}>Otevřít v aplikaci</Link>
          </Button>
          {jobUrl ? (
            <Button asChild type="button" variant="outline" className="min-h-10">
              <Link href={jobUrl}>Otevřít zakázku</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
