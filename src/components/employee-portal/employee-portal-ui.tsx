"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/** Světlé kompaktní styly zaměstnaneckého portálu (desktop + mobil). */
export const employeePortalShellClass =
  "mx-auto w-full max-w-5xl space-y-3 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 sm:space-y-4 sm:px-4 lg:px-0";

export const employeePortalCardClass =
  "rounded-xl border border-slate-200/90 bg-white shadow-sm";

export function EmployeePortalPageShell(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(employeePortalShellClass, props.className)}>{props.children}</div>
  );
}

export function EmployeeCompactHeader(props: {
  title: string;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        employeePortalCardClass,
        "flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3",
        props.className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
            {props.title}
          </h1>
          {props.badge}
        </div>
        {props.subtitle ? (
          <p className="mt-0.5 text-xs leading-snug text-slate-600 sm:text-sm">{props.subtitle}</p>
        ) : null}
        {props.meta ? <div className="mt-1.5 text-xs text-slate-600">{props.meta}</div> : null}
      </div>
      {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
    </header>
  );
}

export function EmployeeStatGrid(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3",
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

export function EmployeeStatTile(props: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        employeePortalCardClass,
        "px-2.5 py-2 sm:px-3 sm:py-2.5",
        props.className
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">
        {props.label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 sm:text-base">
        {props.value}
      </p>
      {props.hint ? (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-500 sm:text-xs">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

export function EmployeePortalSections(props: {
  defaultValue?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Accordion
      type="multiple"
      defaultValue={props.defaultValue}
      className={cn("space-y-2", props.className)}
    >
      {props.children}
    </Accordion>
  );
}

export function EmployeePortalSection(props: {
  value: string;
  icon?: LucideIcon;
  title: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const Icon = props.icon;
  return (
    <AccordionItem
      value={props.value}
      className={cn(
        employeePortalCardClass,
        "overflow-hidden border-b-0 px-1 data-[state=open]:ring-1 data-[state=open]:ring-orange-200/80",
        props.className
      )}
    >
      <AccordionTrigger className="gap-2 px-2.5 py-2.5 text-left hover:no-underline sm:px-3 sm:py-3 [&[data-state=open]]:text-orange-700">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {Icon ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">{props.title}</span>
            {props.summary ? (
              <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                {props.summary}
              </span>
            ) : null}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className={cn("px-2 pb-3 pt-0 sm:px-3 sm:pb-4", props.contentClassName)}>
        {props.children}
      </AccordionContent>
    </AccordionItem>
  );
}

export function EmployeeMobileRecordRow(props: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  trailing?: React.ReactNode;
  detail?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(props.defaultOpen ?? false);
  const hasDetail = Boolean(props.detail);
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-slate-50/50", props.className)}>
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2.5 text-left",
          hasDetail && "min-h-[44px]"
        )}
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900">{props.primary}</div>
          {props.secondary ? (
            <div className="mt-0.5 text-xs text-slate-600">{props.secondary}</div>
          ) : null}
        </div>
        {props.trailing ? <div className="shrink-0 text-right">{props.trailing}</div> : null}
      </button>
      {hasDetail && open ? (
        <div className="border-t border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-700">
          {props.detail}
        </div>
      ) : null}
      {hasDetail && !open ? (
        <div className="border-t border-slate-100 px-3 py-1.5">
          <button
            type="button"
            className="text-xs font-medium text-orange-600 hover:text-orange-700"
            onClick={() => setOpen(true)}
          >
            Detail
          </button>
        </div>
      ) : null}
    </div>
  );
}
