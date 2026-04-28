"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Timer, Wallet, MessageSquare, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MobileModuleGrid } from "@/components/portal/mobile-dashboard/MobileModuleGrid";
import type { PlatformModuleCode } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import type { CompanyPlatformFields } from "@/lib/platform-access";

function dayPartGreeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 11) return "Dobré ráno";
  if (h < 17) return "Dobrý den";
  return "Dobrý večer";
}

function formatCompanySubline(companyLabel: string): string {
  const d = new Date();
  const date = d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
  return `Přehled firmy ${companyLabel} • ${date}`;
}

export function MobileDashboard(props: {
  displayName: string;
  companyLabel: string;
  role?: string;
  company: CompanyPlatformFields | null | undefined;
  platformCatalog: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null | undefined;
  /** Náhled kalendáře + otevření modalu z rodiče. */
  schedulePreview?: React.ReactNode;
  /** Úkoly pod moduly (stejný zdroj jako desktop „ÚKOLY“). */
  tasksSection?: React.ReactNode;
  /** Otevře plný kalendář (modal) — sdílené s dlaždicí Kalendář. */
  onOpenScheduleModal?: () => void;
  unreadMessages?: number;
  overduePlatformInvoices?: number;
  unpaidPlatformInvoices?: number;
  quickStats?: {
    hoursLabel?: string;
    payrollLabel?: string;
    messagesLabel?: string;
    unpaidLabel?: string;
    jobsLabel?: string;
  };
}) {
  const greet = dayPartGreeting();
  const name = props.displayName || "uživateli";

  const stats = props.quickStats ?? {};
  const unread = Number(props.unreadMessages) || 0;
  const badgeCount = unread;

  return (
    <div
      className={cn(
        "lg:hidden",
        "-mx-3 -my-3 px-4 pb-24 pt-5 sm:-mx-4 sm:-my-4 sm:px-6 sm:pt-6 md:-mx-6 md:-my-6 md:px-8 md:pt-8",
        "bg-slate-950 text-slate-50"
      )}
    >
      <header className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">
            {greet}, {name} <span aria-hidden>👋</span>
          </p>
          <p className="text-[12px] text-slate-400">{formatCompanySubline(props.companyLabel)}</p>
        </div>

        {props.schedulePreview ? (
          <div className="min-w-0 max-w-full overflow-x-hidden">
            {props.schedulePreview}
          </div>
        ) : null}
      </header>

      <div className="mt-6 space-y-6">
        <MobileModuleGrid
          company={props.company}
          platformCatalog={props.platformCatalog}
          role={props.role}
          onOpenSchedule={props.onOpenScheduleModal}
        />

        {props.tasksSection ? (
          <div className="min-w-0 max-w-full overflow-x-hidden">
            {props.tasksSection}
          </div>
        ) : null}

        <section aria-label="Rychlý přehled" className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">Rychlý přehled</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            <QuickRow
              title="Odpracované hodiny"
              value={stats.hoursLabel || "—"}
              Icon={Timer}
              href="/portal/employee/worklogs"
            />
            <QuickRow
              title="Výplaty (vrácení)"
              value={stats.payrollLabel || "—"}
              Icon={Wallet}
              href="/portal/labor/vyplaty"
            />
            <QuickRow
              title="Nové zprávy"
              value={stats.messagesLabel || (unread ? `${unread}` : "—")}
              Icon={MessageSquare}
              href={props.role === "employee" ? "/portal/employee/messages" : "/portal/chat"}
              badge={unread}
            />
            <QuickRow
              title="Neuhrazené faktury"
              value={
                props.overduePlatformInvoices || props.unpaidPlatformInvoices
                  ? `${(props.overduePlatformInvoices || 0) + (props.unpaidPlatformInvoices || 0)}`
                  : "—"
              }
              Icon={Receipt}
              href="/portal/vyuctovani"
              tone={(props.overduePlatformInvoices || 0) > 0 ? "danger" : "default"}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function QuickRow(props: {
  title: string;
  value: string;
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  tone?: "default" | "danger";
}) {
  const badge = Number(props.badge) || 0;
  const danger = props.tone === "danger";
  return (
    <Link
      href={props.href}
      className={cn(
        "relative rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur",
        "active:scale-[0.99] transition-transform"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{props.title}</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", danger ? "text-rose-200" : "text-white")}>
            {props.value}
          </p>
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b to-transparent",
            danger ? "from-rose-500/20" : "from-orange-500/20"
          )}
        >
          <props.Icon className={cn("h-5 w-5", danger ? "text-rose-200" : "text-orange-300")} />
        </div>
      </div>
      {badge > 0 ? (
        <span className="absolute right-3 top-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-slate-950">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

