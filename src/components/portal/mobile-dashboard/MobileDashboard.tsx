"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Bell, Menu, ArrowRight, ClipboardList, Timer, Wallet, MessageSquare, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MobileModuleGrid } from "@/components/portal/mobile-dashboard/MobileModuleGrid";
import { MobileMeetingsMiniCalendar } from "@/components/portal/mobile-dashboard/MobileMeetingsMiniCalendar";
import type { PlatformModuleCode } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import type { CompanyPlatformFields } from "@/lib/platform-access";

type TaskItem = {
  id: string;
  title: string;
  statusLabel: string;
  tone: "today" | "soon" | "late";
};

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

  const tasks = useMemo((): TaskItem[] => {
    return [];
  }, []);

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
      <header className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-500/25">
                <span className="text-sm font-extrabold text-orange-300">R</span>
              </div>
              <div className="leading-tight">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">RAJMONDATA</p>
                <p className="text-xs text-slate-400">Mobilní dashboard</p>
              </div>
            </div>

            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
              {greet}, {name} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-1 text-sm text-slate-300">{formatCompanySubline(props.companyLabel)}</p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Link
              href="/portal/notifications"
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur"
              aria-label="Notifikace"
            >
              <Bell className="h-5 w-5 text-slate-200" />
              {badgeCount > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-slate-950">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              ) : null}
            </Link>
            <Link
              href="/portal/settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur"
              aria-label="Menu"
            >
              <Menu className="h-5 w-5 text-slate-200" />
            </Link>
          </div>
        </div>

        <MobileMeetingsMiniCalendar />
      </header>

      <div className="mt-6 space-y-6">
        <MobileModuleGrid company={props.company} platformCatalog={props.platformCatalog} role={props.role} />

        <section aria-label="Moje úkoly" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">Moje úkoly</h2>
            <Link href="/portal/dashboard" className="text-xs font-semibold text-orange-300">
              Zobrazit všechny <ArrowRight className="ml-1 inline h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            {tasks.length === 0 ? (
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <ClipboardList className="h-5 w-5 text-orange-300" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">Zatím žádné úkoly</p>
                  <p className="text-xs text-slate-300">Až se objeví nové úkoly nebo upozornění, uvidíte je tady.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">{t.title}</p>
                    <Badge
                      className={cn(
                        "border border-white/10 bg-white/5 text-slate-200",
                        t.tone === "today" && "bg-orange-500/15 text-orange-200 border-orange-500/20",
                        t.tone === "late" && "bg-rose-500/15 text-rose-200 border-rose-500/20"
                      )}
                    >
                      {t.statusLabel}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

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

