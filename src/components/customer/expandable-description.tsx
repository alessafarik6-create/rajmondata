"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  /** Tailwind line-clamp třída v zabaleném stavu */
  collapsedClassName?: string;
  className?: string;
};

function paragraphize(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  return t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Delší popis: zkrácení + „Zobrazit více“. Krátký text bez tlačítka.
 */
export function ExpandableDescription({
  text,
  collapsedClassName = "line-clamp-4",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const paragraphs = useMemo(() => paragraphize(text), [text]);
  const flatLen = text.trim().length;
  const multiBreak = (text.match(/\n{2,}/g) ?? []).length > 0;
  const needsToggle = flatLen > 280 || multiBreak || paragraphs.length > 2;

  if (!text.trim()) return null;

  if (!needsToggle) {
    return (
      <div
        className={cn(
          "space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200 sm:text-[15px] sm:leading-7",
          className
        )}
      >
        {paragraphs.length
          ? paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {p}
              </p>
            ))
          : (
            <p className="whitespace-pre-wrap">{text}</p>
          )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200 sm:text-[15px] sm:leading-7",
          !open && collapsedClassName
        )}
      >
        {paragraphs.length
          ? paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {p}
              </p>
            ))
          : (
            <p className="whitespace-pre-wrap">{text}</p>
          )}
      </div>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-sm font-semibold text-primary"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Zobrazit méně" : "Zobrazit více"}
      </Button>
    </div>
  );
}
