"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, Sparkles } from "lucide-react";
import type { KnowledgeSearchAnswer } from "@/lib/search/types";
import { KnowledgePagePreview } from "@/components/ai-center/knowledge-page-preview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  answer: KnowledgeSearchAnswer;
  loading?: boolean;
  compact?: boolean;
};

export function KnowledgeSearchAnswerCard({ answer, loading, compact }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30">
        <p className="flex items-center gap-2 font-medium text-blue-800 dark:text-blue-200">
          <Sparkles className="h-4 w-4 animate-pulse" />
          Hledám ve firemních návodech…
        </p>
      </div>
    );
  }

  if (!answer.found) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          {answer.answerText}
        </p>
      </div>
    );
  }

  const primary = answer.primarySource ?? answer.sources[0] ?? null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-semibold">Odpověď z firemního manuálu</span>
      </div>

      <div className={compact ? "space-y-3" : "grid gap-4 lg:grid-cols-[1fr,min(280px,40%)]"}>
        <div className="space-y-3 min-w-0">
          <p className="text-sm whitespace-pre-wrap">{answer.answerText}</p>

          {primary && (
            <div className="rounded border bg-background/80 p-3 text-xs space-y-1">
              <p className="font-medium">Zdroj</p>
              <p>
                {primary.fileName || primary.documentTitle}
                {primary.pageNumber != null ? ` · strana ${primary.pageNumber}` : ""}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline">
                  <Link href={primary.openUrl} target="_blank" rel="noopener noreferrer">
                    Otevřít v manuálu
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {answer.relatedSources.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Další související zdroje</p>
              <ul className="space-y-1">
                {answer.relatedSources.map((s, i) => (
                  <li key={`${s.fileName}-${s.pageNumber}-${i}`}>
                    <Link href={s.openUrl} className="text-blue-700 hover:underline" target="_blank" rel="noopener noreferrer">
                      {s.fileName || s.documentTitle}
                      {s.pageNumber != null ? ` · str. ${s.pageNumber}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {primary?.downloadUrl && primary.pageNumber != null && (primary.hasVisualContent || answer.needsVisualContext) ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">Náhled stránky</Badge>
            </div>
            <KnowledgePagePreview
              pdfUrl={primary.downloadUrl}
              pageNumber={primary.pageNumber}
              alt={`${primary.fileName || primary.documentTitle} — strana ${primary.pageNumber}`}
              compact={compact}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
