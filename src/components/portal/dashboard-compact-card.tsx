"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

type Props = {
  title: string;
  /** Vedle nadpisu (např. součet v Kč). */
  titleAddon?: React.ReactNode;
  icon: React.ReactNode;
  accentClass?: string;
  href?: string;
  footerLabel?: string;
  children: React.ReactNode;
  className?: string;
};

/** Kompaktní dashboard karta — inspirace blokům v detailu zakázky. */
export function DashboardCompactCard({
  title,
  titleAddon,
  icon,
  accentClass = "border-l-sky-500",
  href,
  footerLabel = "Otevřít",
  children,
  className,
}: Props) {
  return (
    <article
      className={cn(
        "flex min-h-[240px] max-h-[320px] flex-col rounded-xl border border-border/80 bg-card shadow-sm",
        "border-l-[3px]",
        accentClass,
        className
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pt-3.5 pb-1">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-sm font-semibold leading-tight text-foreground">{title}</h2>
          {titleAddon ? (
            <span className="text-sm font-semibold tabular-nums text-violet-800">{titleAddon}</span>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 pb-2 text-sm">{children}</div>
      {href ? (
        <footer className="border-t border-border/60 px-3.5 py-2">
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {footerLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </footer>
      ) : null}
    </article>
  );
}
