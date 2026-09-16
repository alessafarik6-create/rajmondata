"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function JobContractAddendumAiSection(props: {
  brief: string;
  onBriefChange: (v: string) => void;
  draftText: string;
  onDraftChange: (v: string) => void;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  onImprove: () => void;
}) {
  const {
    brief,
    onBriefChange,
    draftText,
    onDraftChange,
    loading,
    error,
    disabled,
    onGenerate,
    onRegenerate,
    onImprove,
  } = props;

  const hasDraft = draftText.trim().length > 0;

  return (
    <div className="space-y-4 rounded-lg border border-violet-200/80 bg-violet-50/40 p-3 sm:p-4">
      <div>
        <p className="text-sm font-semibold text-gray-950">AI návrh dodatku</p>
        <p className="text-xs text-gray-700">
          Profesionální návrh smluvního textu — vždy zkontrolujte a upravte před uložením.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="addendum-ai-brief">Co chcete dodatkem změnit nebo doplnit?</Label>
        <Textarea
          id="addendum-ai-brief"
          value={brief}
          onChange={(e) => onBriefChange(e.target.value)}
          disabled={disabled || loading}
          placeholder="Např. změna termínu dokončení na 30. 9. 2026 z důvodu schválených víceprací, cena díla se navyšuje o 180 000 Kč bez DPH…"
          className="min-h-[120px] w-full min-w-0 resize-y bg-white text-[13px] sm:text-sm"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          className="min-h-10 w-full gap-2 sm:w-auto"
          disabled={disabled || loading || brief.trim().length < 8}
          onClick={onGenerate}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Vytvořit profesionální text pomocí AI
        </Button>
        {hasDraft ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 w-full sm:w-auto"
              disabled={disabled || loading || brief.trim().length < 8}
              onClick={onRegenerate}
            >
              Vygenerovat znovu
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 w-full sm:w-auto"
              disabled={disabled || loading || brief.trim().length < 8}
              onClick={onImprove}
            >
              Vylepšit text
            </Button>
          </>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-violet-900">AI připravuje návrh dodatku…</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-2 border-t border-violet-200/60 pt-3">
        <Label htmlFor="addendum-draft-text">Text dodatku</Label>
        <Textarea
          id="addendum-draft-text"
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          disabled={disabled}
          placeholder="Zde se zobrazí návrh dodatku — můžete ho upravit nebo napsat ručně…"
          className={cn(
            "min-h-[220px] w-full min-w-0 resize-y bg-white text-[13px] sm:min-h-[260px] sm:text-sm"
          )}
        />
      </div>
    </div>
  );
}
