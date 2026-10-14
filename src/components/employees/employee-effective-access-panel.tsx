"use client";

import React, { useMemo } from "react";
import type { EmployeePortalRoleId } from "@/lib/employee-portal-role";
import {
  buildEmployeePortalAccessSnapshot,
  type PortalPermissionLimitReason,
} from "@/lib/portal-permissions-admin";
import type { PortalAccessLevel } from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ACCESS_LABELS: Record<PortalAccessLevel, string> = {
  none: "Bez přístupu",
  read: "Náhled",
  write: "Zápis",
};

const REASON_LABELS: Record<PortalPermissionLimitReason, string> = {
  stored: "Uložená matice",
  legacy_preset: "Výchozí / legacy role",
  org_role_cap: "Omezení role",
  license: "Licence organizace",
  platform_module: "Modul platformy",
};

function LevelBadge(props: { level: PortalAccessLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
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
  permissionsDirty?: boolean;
  className?: string;
}) {
  const snapshot = useMemo(
    () => buildEmployeePortalAccessSnapshot(props.employeeDoc, props.portalRole),
    [props.employeeDoc, props.portalRole]
  );

  const visibleRows = snapshot.moduleRows.filter(
    (r) =>
      r.effectiveLevel !== "none" ||
      r.editorLevel !== "none" ||
      r.roleDefaultLevel !== "none" ||
      r.editorLevel !== r.effectiveLevel
  );

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
          Efektivní přístup vychází z{" "}
          <strong>uložené role v databázi</strong> ({snapshot.savedOrgRoleLabel}) a uložené matice
          modulů — stejná pravidla jako portál a API.
        </p>
        <p className="mt-1 text-xs text-indigo-900/80">
          Uložená role v DB: <strong>{snapshot.savedOrgRoleLabel}</strong>
          {snapshot.rolesDiffer ? (
            <>
              {" "}
              · Role v editoru (neuloženo): <strong>{snapshot.editorOrgRoleLabel}</strong>
            </>
          ) : null}
        </p>
        {!snapshot.materialized ? (
          <p className="mt-1 text-xs font-medium text-amber-900">
            Matice ještě nebyla materializována uložením v adminu — část přístupu může vycházet z
            legacy polí, dokud neuložíte oprávnění.
          </p>
        ) : null}
      </div>

      {props.permissionsDirty && snapshot.rolesDiffer ? (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-xs text-amber-950">
            Máte neuloženou změnu role v editoru. Sloupec „Efektivní“ ukazuje{" "}
            <strong>uloženou</strong> roli ({snapshot.savedOrgRoleLabel}), ne náhled v editoru.
            Po uložení se oba sloupce sjednotí.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="hidden lg:grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[10px] font-semibold uppercase tracking-wide text-indigo-800/80 pb-1 border-b border-indigo-100">
        <span>Modul</span>
        <span className="text-right">Matice (editor)</span>
        <span className="text-right">Výchozí role</span>
        <span className="text-right">Efektivní</span>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
        <li className="grid grid-cols-1 gap-1 border-b border-indigo-100 pb-1 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center lg:gap-2">
          <span className="font-medium text-indigo-950">Kalendář — Schůzky</span>
          <LevelBadge level={snapshot.calendar.meetings.editor} className="lg:justify-self-end" />
          <LevelBadge
            level={snapshot.calendar.meetings.roleDefault}
            className="lg:justify-self-end"
          />
          <LevelBadge level={snapshot.calendar.meetings.effective} className="lg:justify-self-end" />
        </li>
        <li className="grid grid-cols-1 gap-1 border-b border-indigo-100 pb-1 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center lg:gap-2">
          <span className="font-medium text-indigo-950">Kalendář — Montáže</span>
          <LevelBadge
            level={snapshot.calendar.installations.editor}
            className="lg:justify-self-end"
          />
          <LevelBadge
            level={snapshot.calendar.installations.roleDefault}
            className="lg:justify-self-end"
          />
          <LevelBadge
            level={snapshot.calendar.installations.effective}
            className="lg:justify-self-end"
          />
        </li>
        {visibleRows.map((row) => (
          <li
            key={row.moduleId}
            className="grid grid-cols-1 gap-0.5 border-b border-indigo-100/80 pb-1 last:border-0 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center lg:gap-2"
          >
            <span className="text-indigo-950">{row.label}</span>
            <LevelBadge level={row.editorLevel} className="lg:justify-self-end" />
            <LevelBadge level={row.roleDefaultLevel} className="lg:justify-self-end" />
            <div className="flex flex-col items-end gap-0.5 lg:justify-self-end">
              <LevelBadge level={row.effectiveLevel} />
              {row.editorLevel !== row.effectiveLevel && row.limitReason ? (
                <span className="text-[10px] text-indigo-700/90 text-right max-w-[14rem]">
                  {REASON_LABELS[row.limitReason]}
                </span>
              ) : null}
            </div>
          </li>
        ))}
        {!calAny && visibleRows.length === 0 ? (
          <li className="text-indigo-800">Žádné pracovní moduly — jen profil a přihlášení.</li>
        ) : null}
      </ul>
      <p className="text-[10px] text-indigo-800">
        Řádky zobrazují moduly s nastavením nebo efektivním přístupem. Sloupec „Efektivní“ je
        rozhodující pro portál a API (včetně produktových katalogů).
      </p>
    </div>
  );
}
