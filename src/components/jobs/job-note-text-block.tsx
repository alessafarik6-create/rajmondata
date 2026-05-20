"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Typ bloku poznámky — barva pozadí/okraje, text vždy tmavý. */
export type JobNoteVariant = "admin_request" | "customer" | "internal" | "system";

const VARIANT_SHELL: Record<JobNoteVariant, string> = {
  admin_request:
    "border border-gray-200 border-l-[3px] border-l-orange-500 bg-white shadow-sm",
  customer:
    "border border-amber-100 border-l-[3px] border-l-amber-500 bg-amber-50/40",
  internal:
    "border border-gray-200 border-l-[3px] border-l-slate-400 bg-slate-50/80",
  system:
    "border border-gray-200 border-l-[3px] border-l-sky-500 bg-sky-50/50",
};

const BODY_CLASS =
  "min-w-0 max-w-full break-words whitespace-pre-wrap text-sm leading-relaxed text-gray-900 sm:text-[15px] sm:leading-relaxed";

const LABEL_CLASS =
  "mb-1 block text-xs font-semibold tracking-wide text-gray-700 sm:text-[13px]";

function noteNeedsExpandToggle(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lineCount = t.split("\n").length;
  if (lineCount > 5) return true;
  if (t.length > 220) return true;
  if ((t.match(/\n{2,}/g) ?? []).length > 0) return true;
  return false;
}

/**
 * Dlouhý text poznámky: náhled (~5 řádků), „Zobrazit celé“ / „Skrýt“.
 */
export function ExpandableNoteText({
  text,
  className,
  collapsedClassName = "line-clamp-5",
  dense = false,
}: {
  text: string;
  className?: string;
  collapsedClassName?: string;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  const needsToggle = useMemo(() => noteNeedsExpandToggle(trimmed), [trimmed]);

  if (!trimmed) return null;

  const bodyClass = cn(BODY_CLASS, dense && "text-xs sm:text-sm", className);

  if (!needsToggle) {
    return <p className={bodyClass}>{trimmed}</p>;
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <p className={cn(bodyClass, !open && collapsedClassName)}>{trimmed}</p>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-xs font-semibold text-orange-700 underline-offset-4 hover:text-orange-800 sm:text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Skrýt" : "Zobrazit celé"}
      </Button>
    </div>
  );
}

/**
 * Čitelný blok dlouhého textu poznámky / připomínky u zakázky.
 * Oranžová/žlutá jen na okraji — obsah je vždy tmavě šedý.
 */
export function JobNoteTextBlock({
  variant,
  label,
  children,
  className,
  dense = false,
  expandable = true,
}: {
  variant: JobNoteVariant;
  label?: string;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
  expandable?: boolean;
}) {
  const body =
    expandable && typeof children === "string" ? (
      <ExpandableNoteText text={children} dense={dense} />
    ) : (
      <div className={cn(BODY_CLASS, dense && "text-xs sm:text-sm")}>{children}</div>
    );

  return (
    <div
      className={cn(
        "min-w-0 rounded-md px-3 py-2.5",
        dense && "px-2.5 py-2",
        VARIANT_SHELL[variant],
        className
      )}
    >
      {label ? <p className={LABEL_CLASS}>{label}</p> : null}
      {body}
    </div>
  );
}

/** Meta řádek (datum, stav) pod poznámkou. */
export function JobNoteMetaLine({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("min-w-0 text-xs leading-snug text-gray-600", className)}>{children}</p>
  );
}
