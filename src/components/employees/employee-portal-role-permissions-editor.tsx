"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldAlert } from "lucide-react";
import {
  EMPLOYEE_PORTAL_ROLE_OPTIONS,
  type EmployeePortalRoleId,
} from "@/lib/employee-portal-role";
import {
  applyManagerPermissionCaps,
  applyPermissionPreset,
  buildAccountantPermissionPreset,
  buildManagerPermissionPreset,
  buildOrgAdminPermissionPreset,
  legacyAccessFlagsFromPortalPermissions,
  portalPermissionsToLegacyEmployeeModules,
  PORTAL_PERMISSION_MODULES,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { EmployeeCalendarPermissionsBlock } from "@/components/employees/employee-calendar-permissions-block";
import {
  aggregateScheduleModuleLevel,
  initialCalendarPermissionsForEmployee,
  type CalendarSubPermissionKey,
} from "@/lib/calendar/calendar-access";

const ACCESS_LABELS: Record<PortalAccessLevel, string> = {
  none: "Bez přístupu",
  read: "Náhled",
  write: "Zápis",
};

export function EmployeePortalRolePermissionsEditor(props: {
  portalRole: EmployeePortalRoleId;
  onPortalRoleChange: (role: EmployeePortalRoleId) => void;
  levels: Record<PortalModuleId, PortalAccessLevel>;
  onLevelsChange: (levels: Record<PortalModuleId, PortalAccessLevel>) => void;
  calendarLevels: Record<CalendarSubPermissionKey, PortalAccessLevel>;
  onCalendarLevelsChange: (levels: Record<CalendarSubPermissionKey, PortalAccessLevel>) => void;
  dashboardAiAssistantEnabled?: boolean;
  onDashboardAiAssistantEnabledChange?: (enabled: boolean) => void;
  disabled?: boolean;
  roleSelectClassName?: string;
  /** Před změnou role (např. potvrzení přepsání individuální matice). */
  confirmRoleChange?: (args: {
    nextRole: EmployeePortalRoleId;
    currentRole: EmployeePortalRoleId;
  }) => boolean;
}) {
  const {
    portalRole,
    onPortalRoleChange,
    levels,
    onLevelsChange,
    calendarLevels,
    onCalendarLevelsChange,
    dashboardAiAssistantEnabled = true,
    onDashboardAiAssistantEnabledChange,
    disabled,
    roleSelectClassName,
    confirmRoleChange,
  } = props;

  const isOrgAdmin = portalRole === "orgAdmin";
  const isManager = portalRole === "manager";

  const applyLevelsForRole = (role: EmployeePortalRoleId) => {
    if (role === "accountant") {
      onLevelsChange(buildAccountantPermissionPreset());
    } else if (role === "orgAdmin") {
      onLevelsChange(buildOrgAdminPermissionPreset());
    } else if (role === "manager") {
      const next = buildManagerPermissionPreset();
      onLevelsChange(next);
      syncCalendarFromLevels(next);
    }
  };

  const handleRoleChange = (raw: string) => {
    const role = raw as EmployeePortalRoleId;
    if (role === portalRole) return;
    if (confirmRoleChange && !confirmRoleChange({ nextRole: role, currentRole: portalRole })) {
      return;
    }
    onPortalRoleChange(role);
    applyLevelsForRole(role);
  };

  const syncCalendarFromLevels = (next: Record<PortalModuleId, PortalAccessLevel>) => {
    onCalendarLevelsChange(
      initialCalendarPermissionsForEmployee(null, next.schedule ?? "none")
    );
  };

  const applyPreset = (
    preset: "accountant" | "employee" | "manager" | "read_all" | "none_all"
  ) => {
    let next = applyPermissionPreset(preset);
    if (isManager || preset === "manager") {
      next = applyManagerPermissionCaps(next);
    }
    onLevelsChange(next);
    syncCalendarFromLevels(next);
  };

  const setAll = (level: PortalAccessLevel) => {
    const next = { ...levels };
    for (const mod of PORTAL_PERMISSION_MODULES) {
      next[mod.id] = level;
    }
    const capped = isManager ? applyManagerPermissionCaps(next) : next;
    onLevelsChange(capped);
    onCalendarLevelsChange({
      meetings: level,
      installations: level,
    });
  };

  const moduleRows = PORTAL_PERMISSION_MODULES.filter((m) => m.id !== "schedule");
  const [moduleSearch, setModuleSearch] = useState("");
  const filteredModuleRows = useMemo(() => {
    const q = moduleSearch.trim().toLowerCase();
    if (!q) return moduleRows;
    return moduleRows.filter((m) => m.label.toLowerCase().includes(q));
  }, [moduleRows, moduleSearch]);

  const derivedAccess = useMemo(
    () => ({
      flags: legacyAccessFlagsFromPortalPermissions(levels),
      legacyMenu: portalPermissionsToLegacyEmployeeModules(levels),
    }),
    [levels]
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          1. Role v organizaci
        </Label>
        <select
          className={cn(
            "flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-black",
            roleSelectClassName
          )}
          disabled={disabled}
          value={portalRole}
          onChange={(e) => handleRoleChange(e.target.value)}
        >
          {EMPLOYEE_PORTAL_ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!isOrgAdmin ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              2. Předvolby oprávnění
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => applyPreset("accountant")}
              >
                Účetní
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => applyPreset("manager")}
              >
                Manažer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => applyPreset("read_all")}
              >
                Vše náhled
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => applyPreset("none_all")}
              >
                Vše bez přístupu
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-black">4. Speciální oprávnění (odvozeno z modulů)</p>
            <p className="text-xs text-slate-600">
              Sklad, výroba, záznamy ze schůzek a položky menu portálu se ukládají společně s maticí
              modulů — bez duplicitních přepínačů.
            </p>
            <ul className="grid gap-1 text-xs text-slate-800 sm:grid-cols-2">
              <li>Sklad: {derivedAccess.flags.canAccessWarehouse ? "ano" : "ne"}</li>
              <li>Výroba: {derivedAccess.flags.canAccessProduction ? "ano" : "ne"}</li>
              <li>Schůzky u zakázek: {derivedAccess.flags.canAccessMeetingNotes ? "ano" : "ne"}</li>
              <li>Menu Zakázky: {derivedAccess.legacyMenu.zakazky ? "ano" : "ne"}</li>
              <li>Menu Peníze: {derivedAccess.legacyMenu.penize ? "ano" : "ne"}</li>
              <li>Menu Zprávy: {derivedAccess.legacyMenu.zpravy ? "ano" : "ne"}</li>
              <li>Menu Docházka / mzdy: {derivedAccess.legacyMenu.dochazka ? "ano" : "ne"}</li>
            </ul>
          </div>

          <div className="rounded-md border border-slate-200 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-black">3. Přístup k modulům</p>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span>Nastavit vše:</span>
                {(["none", "read", "write"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    className="underline hover:text-slate-900 disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => setAll(l)}
                  >
                    {ACCESS_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>
            <Input
              className="border-slate-300"
              placeholder="Hledat modul podle názvu…"
              value={moduleSearch}
              disabled={disabled}
              onChange={(e) => setModuleSearch(e.target.value)}
            />
            <div className="hidden grid-cols-[1fr_auto] gap-2 border-b border-slate-100 pb-2 text-xs font-medium text-slate-500 sm:grid">
              <span>Sekce</span>
              <span className="w-[168px] text-right">Přístup</span>
            </div>
            <ul className="mt-2 max-h-[min(420px,50vh)] space-y-2 overflow-y-auto pr-1">
              <EmployeeCalendarPermissionsBlock
                levels={calendarLevels}
                onChange={(cal) => {
                  onCalendarLevelsChange(cal);
                  onLevelsChange({
                    ...levels,
                    schedule: aggregateScheduleModuleLevel(cal),
                  });
                }}
                disabled={disabled}
              />
              {filteredModuleRows.map((mod) => (
                <li
                  key={mod.id}
                  className="flex flex-col gap-1.5 border-b border-slate-50 pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <Label className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                      {mod.label}
                      {mod.sensitive ? (
                        <ShieldAlert
                          className="h-3.5 w-3.5 text-amber-600"
                          aria-label="Citlivá data"
                        />
                      ) : null}
                    </Label>
                    {mod.id === "labor" && portalRole === "employee" ? (
                      <p className="mt-0.5 text-xs text-slate-600">
                        Zaměstnanec má přístup pouze ke svým mzdovým údajům. Jejich
                        úprava není povolena.
                      </p>
                    ) : null}
                  </div>
                  <Select
                    disabled={disabled}
                    value={levels[mod.id as PortalModuleId]}
                    onValueChange={(v) => {
                      const next = {
                        ...levels,
                        [mod.id]: v as PortalAccessLevel,
                      };
                      onLevelsChange(isManager ? applyManagerPermissionCaps(next) : next);
                    }}
                  >
                    <SelectTrigger className="w-full border-slate-300 sm:w-[168px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{ACCESS_LABELS.none}</SelectItem>
                      <SelectItem value="read">{ACCESS_LABELS.read}</SelectItem>
                      <SelectItem value="write">{ACCESS_LABELS.write}</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-slate-200 p-4 space-y-2">
            <p className="text-sm font-semibold text-black">Dashboard</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Label className="text-sm font-medium text-slate-900">
                  Zobrazovat AI sekretářku na hlavní stránce
                </Label>
                <p className="text-xs text-slate-600 mt-0.5">
                  Widget RAJMONDATA AI na přehledu. Neovlivňuje modul AI centrum v menu.
                </p>
              </div>
              <Switch
                checked={dashboardAiAssistantEnabled}
                disabled={disabled || !onDashboardAiAssistantEnabledChange}
                onCheckedChange={(v) => onDashboardAiAssistantEnabledChange?.(v)}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-950">
          <p className="font-semibold">Plný přístup ke všem modulům</p>
          <p className="mt-1 text-emerald-900/90">
            Administrátor organizace má ve firemním portálu oprávnění Zápis ke všem sekcím. Matice
            modulů se pro tuto roli neupravuje.
          </p>
        </div>
      )}
    </div>
  );
}
