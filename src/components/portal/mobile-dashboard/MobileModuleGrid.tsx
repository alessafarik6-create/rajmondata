"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { doc } from "firebase/firestore";
import { useDoc, useFirestore, useMemoFirebase, useCompany, useUser } from "@/firebase";
import { getEffectiveModulesMerged } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { buildMobileHomeTiles } from "@/lib/portal-mobile-home-nav";

/** Klíče dlaždic pro badge — `tasks`, `chat`, `calendar`, … */
export type MobileModuleTileId = string;

const tileButtonClass =
  "group relative flex h-[100px] w-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 text-center shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur active:scale-[0.99] transition-transform";

const tileLinkClass =
  "group relative flex h-[100px] flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur active:scale-[0.99] transition-transform min-w-0";

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
  role?: string;
  onOpenSchedule?: () => void;
  moduleBadgeCounts?: Partial<Record<MobileModuleTileId, number>>;
}) {
  const role = String(props.role || "employee");
  const { company, companyId } = useCompany();
  const { user } = useUser();
  const firestore = useFirestore();
  const platformCatalog = useMergedPlatformModuleCatalog();
  const effectiveModules = useMemo(() => getEffectiveModulesMerged(company), [company]);

  const userRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: userProfile } = useDoc(userRef);
  const employeeId = userProfile?.employeeId;
  const employeeDocRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", String(employeeId))
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeRow } = useDoc<Record<string, unknown>>(employeeDocRef);

  const visible = useMemo(() => {
    const menuCtx = {
      role,
      globalRoles: (userProfile?.globalRoles as string[] | undefined) ?? undefined,
      company,
      effectiveModules,
      platformCatalog,
      employeeRow: employeeRow ?? null,
    };
    return buildMobileHomeTiles({
      role,
      globalRoles: (userProfile?.globalRoles as string[] | undefined) ?? undefined,
      employeeRow: employeeRow ?? null,
      menuCtx,
    });
  }, [role, userProfile?.globalRoles, company, effectiveModules, platformCatalog, employeeRow]);

  const badges = props.moduleBadgeCounts ?? {};

  return (
    <section aria-label="Moduly" className="space-y-3 min-w-0">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-200">Moduly</h2>
        <Badge variant="secondary" className="border-white/10 bg-white/5 text-slate-200">
          {visible.length}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-3 min-w-0 w-full">
        {visible.map((t) => {
          const badgeCount = Math.max(0, Math.floor(Number(badges[t.key]) || 0));
          const body = (
            <div className="flex h-full flex-col items-center justify-center text-center min-w-0 w-full">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-orange-500/20 to-transparent">
                <t.Icon className="h-5 w-5 text-orange-300" />
                <ModuleIconCountBadge count={badgeCount} />
              </div>
              <p className="mt-2 w-full text-[11px] font-semibold leading-tight text-white line-clamp-2 px-0.5">
                {t.title}
              </p>
            </div>
          );

          if (t.openSchedule && props.onOpenSchedule) {
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => props.onOpenSchedule?.()}
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
