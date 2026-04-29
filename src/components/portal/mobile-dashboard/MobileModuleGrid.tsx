"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  ListChecks,
  Users,
  Clock,
  Wallet,
  Timer,
  Briefcase,
  PieChart,
  MessageSquare,
  Stamp,
  UserRound,
  UsersRound,
  FileText,
  FileStack,
  Package,
  Factory,
} from "lucide-react";
import type { PlatformModuleCode } from "@/lib/platform-config";
import type { CompanyPlatformFields } from "@/lib/platform-access";
import { canAccessCompanyModule } from "@/lib/platform-access";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";

/**
 * Klíče dlaždic v mřížce — hodnoty `moduleBadgeCounts` používají stejné řetězce
 * (`tasks`, `chat`, `jobs`, …) pro budoucí rozšíření (Zprávy, Podpora, Faktury, …).
 */
export type MobileModuleTileId =
  | "calendar"
  | "tasks"
  | "employees"
  | "attendance"
  | "payroll"
  | "hours"
  | "jobs"
  | "costs"
  | "chat"
  | "approvals"
  | "customers"
  | "team"
  | "invoices"
  | "docs"
  | "warehouse"
  | "production";

type Tile = {
  key: MobileModuleTileId;
  title: string;
  description: string;
  href?: string;
  /** Otevře kalendářový modal místo navigace. */
  openSchedule?: boolean;
  hideDescription?: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  requires?: PlatformModuleCode;
  /** Když modul nemá přímý kód (např. interní stránky), dá se řídit externě. */
  enabled?: boolean;
};

const tileButtonClass =
  "group relative flex h-[100px] w-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 text-center shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur active:scale-[0.99] transition-transform";

const tileLinkClass =
  "group relative flex h-[100px] flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur active:scale-[0.99] transition-transform";

function ModuleIconCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 flex min-h-[1.125rem] min-w-[1.125rem] max-w-[2.25rem] items-center justify-center rounded-sm bg-red-600 px-0.5 text-[10px] font-bold leading-none text-white shadow-sm ring-1 ring-black/30"
      aria-label={`Počet: ${label}`}
    >
      {label}
    </span>
  );
}

export function MobileModuleGrid(props: {
  company: CompanyPlatformFields | null | undefined;
  platformCatalog: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null | undefined;
  role?: string;
  onOpenSchedule?: () => void;
  /** Počty upozornění podle `Tile.key` (např. `tasks`, `chat`). Hodnota ≤ 0 = bez badge. */
  moduleBadgeCounts?: Partial<Record<MobileModuleTileId, number>>;
}) {
  const role = String(props.role || "");
  const company = props.company;
  const catalog = props.platformCatalog ?? undefined;

  const tiles = useMemo((): Tile[] => {
    const hoursHref = role === "employee" ? "/portal/employee/worklogs" : "/portal/labor/vykazy";
    const approvalsHref = "/portal/labor/vykazy";
    const docsHref = "/portal/documents";
    const invoicesHref = "/portal/documents?view=issued";

    return [
      {
        key: "calendar",
        title: "Kalendář",
        description: "Schůzky a zaměření",
        openSchedule: true,
        hideDescription: true,
        Icon: CalendarDays,
        enabled: true,
      },
      { key: "tasks", title: "Úkoly", description: "Moje úkoly a seznamy", href: "/portal/tasks", Icon: ListChecks, enabled: true },
      { key: "employees", title: "Zaměstnanci", description: "Přehled týmu", href: "/portal/employees", Icon: Users, enabled: true },
      { key: "attendance", title: "Docházka", description: "Evidence a kontrola", href: "/portal/labor/dochazka", Icon: Clock, requires: "attendance_payroll" },
      { key: "payroll", title: "Výplaty", description: "Mzdy a výplaty", href: "/portal/labor/vyplaty", Icon: Wallet, requires: "attendance_payroll" },
      { key: "hours", title: "Hodiny", description: "Odpracovaný čas", href: hoursHref, Icon: Timer, requires: "attendance_payroll" },
      { key: "jobs", title: "Zakázky", description: "Přehled zakázek", href: "/portal/jobs", Icon: Briefcase, requires: "jobs" },
      { key: "costs", title: "Náklady", description: "Náklady a ziskovost", href: "/portal/finance", Icon: PieChart, enabled: true },
      { key: "chat", title: "Komunikace", description: "Zprávy a chat", href: "/portal/chat", Icon: MessageSquare, enabled: true },
      { key: "approvals", title: "Schvalování", description: "Výkazy a dokumenty", href: approvalsHref, Icon: Stamp, requires: "attendance_payroll" },
      { key: "customers", title: "Zákazníci", description: "Přehled zákazníků", href: "/portal/customers", Icon: UserRound, enabled: true },
      { key: "team", title: "Tým", description: "Propojení týmu", href: "/portal/employees", Icon: UsersRound, enabled: true },
      { key: "invoices", title: "Faktury", description: "Vydané faktury", href: invoicesHref, Icon: FileText, requires: "invoicing" },
      { key: "docs", title: "Doklady", description: "Doklady a archiv", href: docsHref, Icon: FileStack, requires: "invoicing" },
      { key: "warehouse", title: "Sklad", description: "Zásoby a pohyby", href: "/portal/sklad", Icon: Package, requires: "sklad" },
      { key: "production", title: "Výroba", description: "Výrobní přehled", href: "/portal/vyroba", Icon: Factory, requires: "vyroba" },
    ];
  }, [role]);

  const visible = useMemo(() => {
    return tiles.filter((t) => {
      if (t.enabled === false) return false;
      if (!t.requires) return true;
      return company ? canAccessCompanyModule(company, t.requires, catalog) : false;
    });
  }, [tiles, company, catalog]);

  const badges = props.moduleBadgeCounts ?? {};

  return (
    <section aria-label="Moduly" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-200">Moduly</h2>
        <Badge variant="secondary" className="border-white/10 bg-white/5 text-slate-200">
          {visible.length}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {visible.map((t) => {
          const badgeCount = Math.max(0, Math.floor(Number(badges[t.key]) || 0));
          const body = (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-orange-500/20 to-transparent">
                <t.Icon className="h-5 w-5 text-orange-300" />
                <ModuleIconCountBadge count={badgeCount} />
              </div>
              <p className="mt-2 text-[12px] font-semibold leading-tight text-white line-clamp-2">
                {t.title}
              </p>
              {t.hideDescription ? null : (
                <p className="mt-1 hidden text-[11px] leading-snug text-slate-300 sm:block line-clamp-1">
                  {t.description}
                </p>
              )}
            </div>
          );

          if (t.openSchedule && props.onOpenSchedule) {
            const openSchedule = props.onOpenSchedule;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => openSchedule()}
                className={tileButtonClass}
              >
                {body}
              </button>
            );
          }

          if (t.openSchedule) {
            return (
              <Link key={t.key} href="/portal/dashboard" className={tileLinkClass}>
                {body}
              </Link>
            );
          }

          return (
            <Link key={t.key} href={t.href ?? "/portal/dashboard"} className={tileLinkClass}>
              {body}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

