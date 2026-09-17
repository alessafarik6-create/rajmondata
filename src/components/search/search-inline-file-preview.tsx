"use client";

import React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { SearchResultItem } from "@/lib/search/types";
import { Button } from "@/components/ui/button";
import { KnowledgePagePreview } from "@/components/ai-center/knowledge-page-preview";
import { cn } from "@/lib/utils";

type Props = {
  item: SearchResultItem;
  onClose: () => void;
  className?: string;
};

export function SearchInlineFilePreview({ item, onClose, className }: Props) {
  const fileUrl = item.fileUrl ?? null;
  const title = item.metadata.fileName ?? item.title;
  const isPdf =
    item.mimeType?.includes("pdf") || title.toLowerCase().endsWith(".pdf");
  const isImage =
    item.mimeType?.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(title);
  const jobId = item.metadata.jobId;
  const jobUrl = jobId ? `/portal/jobs/${encodeURIComponent(jobId)}` : null;

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-slate-50/90 p-3 shadow-sm",
        className
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{title}</p>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mx-auto max-h-[min(50vh,420px)] overflow-auto rounded-md border bg-white p-2">
        {!fileUrl ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Náhled není k dispozici.</p>
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fileUrl}
            alt={title}
            className="mx-auto max-h-[min(48vh,400px)] w-auto max-w-full object-contain"
          />
        ) : isPdf ? (
          <KnowledgePagePreview pdfUrl={fileUrl} pageNumber={1} compact className="w-full min-h-[200px]" />
        ) : (
          <iframe
            title={title}
            src={fileUrl}
            className="h-[min(48vh,400px)] w-full rounded border-0"
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
  );
}
