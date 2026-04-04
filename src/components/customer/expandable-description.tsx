"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  /** Tailwind line-clamp třída v zabaleném stavu */
  collapsedClassName?: string;
  className?: string;
  /**
   * `highContrast` — černá / téměř černá na světlém pozadí (detail produktu).
   * `default` — čitelné na kartách katalogu.
   */
  tone?: "default" | "highContrast";
};

function paragraphize(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  return t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Delší popis: zkrácení + „Zobrazit více“. Krátký text bez tlačítka.
 */
const bodyTone = {
  default: "text-neutral-900 dark:text-zinc-100",
  highContrast: "text-neutral-950 dark:text-zinc-50",
} as const;

export function ExpandableDescription({
  text,
  collapsedClassName = "line-clamp-4",
  className,
  tone = "default",
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
          "space-y-3 text-sm leading-relaxed sm:text-[15px] sm:leading-7",
          bodyTone[tone],
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
          "space-y-3 text-sm leading-relaxed sm:text-[15px] sm:leading-7",
          bodyTone[tone],
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
        className="h-auto p-0 text-sm font-semibold text-orange-700 underline-offset-4 hover:underline dark:text-orange-400"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Zobrazit méně" : "Zobrazit více"}
      </Button>
    </div>
  );
}
