"use client";

import React, { useMemo } from "react";
import type { EmployeePortalRoleId } from "@/lib/employee-portal-role";
import {
  buildEmployeePortalAccessSnapshot,
  type PortalPermissionLimitReason,
} from "@/lib/portal-permissions-admin";
import type { PortalAccessLevel } from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";

const ACCESS_LABELS: Record<PortalAccessLevel, string> = {
  none: "Bez přístupu",
  read: "Náhled",
  write: "Zápis",
};

const REASON_LABELS: Record<PortalPermissionLimitReason, string> = {
  stored: "Uložené nastavení",
  legacy_preset: "Dosavadní výchozí oprávnění (legacy)",
  org_role_cap: "Omezení role zaměstnance",
  license: "Licence organizace",
  platform_module: "Modul platformy",
};

function LevelBadge(props: { level: PortalAccessLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
        props.level === "none" && "bg-slate-100 text-slate-700",
        props.level === "read" && "bg-sky-100 text-sky-900",
        props.level === "write" && "bg-emerald-100 text-emerald-900",
        props.className
      )}
    >
      {ACCESS_LABELS[props.level]}
    </span>
  );
}

export function EmployeeEffectiveAccessPanel(props: {
  employeeDoc: Record<string, unknown> | null | undefined;
  portalRole: EmployeePortalRoleId;
  className?: string;
}) {
  const snapshot = useMemo(
    () => buildEmployeePortalAccessSnapshot(props.employeeDoc, props.portalRole),
    [props.employeeDoc, props.portalRole]
  );

  const enabledModules = snapshot.moduleRows.filter((r) => r.effectiveLevel !== "none");
  const calAny =
    snapshot.calendar.meetings.effective !== "none" ||
    snapshot.calendar.installations.effective !== "none";

  return (
    <div
      className={cn(
        "rounded-md border border-indigo-200 bg-indigo-50/60 p-4 space-y-3",
        props.className
      )}
    >
      <div>
        <p className="text-sm font-semibold text-indigo-950">Skutečný přístup zaměstnance</p>
        <p className="mt-1 text-xs text-indigo-900/80">
          Efektivní oprávnění po vyhodnocení role, uložené matice a legacy polí — stejné jako v
          portálu a API.
          {!snapshot.materialized ? (
            <span className="block mt-1 font-medium">
              Matice ještě nebyla materializována uložením v adminu; běží legacy pravidla, dokud
              neuložíte oprávnění.
            </span>
          ) : null}
        </p>
      </div>

      <div className="hidden sm:grid grid-cols-[1fr_auto_auto] gap-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-800/80 pb-1 border-b border-indigo-100">
        <span>Modul</span>
        <span className="text-right">Nastaveno</span>
        <span className="text-right">Skutečně</span>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
        <li className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-1 sm:grid sm:grid-cols-[1fr_auto_auto]">
          <span className="font-medium text-indigo-950">Kalendář — Schůzky</span>
          <LevelBadge level={snapshot.calendar.meetings.stored} className="sm:justify-self-end" />
          <LevelBadge level={snapshot.calendar.meetings.effective} className="sm:justify-self-end" />
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-1 sm:grid sm:grid-cols-[1fr_auto_auto]">
          <span className="font-medium text-indigo-950">Kalendář — Montáže</span>
          <LevelBadge level={snapshot.calendar.installations.stored} className="sm:justify-self-end" />
          <LevelBadge level={snapshot.calendar.installations.effective} className="sm:justify-self-end" />
        </li>
        {enabledModules.map((row) => (
          <li
            key={row.moduleId}
            className="flex flex-col gap-0.5 border-b border-indigo-100/80 pb-1 last:border-0 sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-2"
          >
            <span className="text-indigo-950">{row.label}</span>
            <LevelBadge level={row.storedLevel} className="sm:justify-self-end" />
            <div className="flex flex-wrap items-center gap-1 sm:justify-self-end">
              <LevelBadge level={row.effectiveLevel} />
              {row.limitReason ? (
                <span className="text-[10px] text-indigo-700/90 w-full sm:w-auto text-right">
                  {REASON_LABELS[row.limitReason]}
                  {row.storedLevel === "write" && row.effectiveLevel !== "write"
                    ? " — zápis v UI/API je omezen"
                    : ""}
                </span>
              ) : row.storedLevel === "write" && row.effectiveLevel === "write" ? (
                <span className="text-[10px] text-indigo-700/90">Individuální matice</span>
              ) : null}
            </div>
          </li>
        ))}
        {!calAny && enabledModules.length === 0 ? (
          <li className="text-indigo-800">Žádné pracovní moduly — jen profil a přihlášení.</li>
        ) : null}
      </ul>
      <p className="text-[10px] text-indigo-800">
        Povolených modulů: {enabledModules.length + (calAny ? 1 : 0)}
        {calAny ? " (včetně kalendáře)" : ""}
      </p>
    </div>
  );
}
