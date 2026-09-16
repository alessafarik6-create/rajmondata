"use client";

import React from "react";
import { Button } from "@/components/ui/button";
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
  applyPermissionPreset,
  buildAccountantPermissionPreset,
  buildOrgAdminPermissionPreset,
  PORTAL_PERMISSION_MODULES,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";

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
  disabled?: boolean;
  roleSelectClassName?: string;
}) {
  const { portalRole, onPortalRoleChange, levels, onLevelsChange, disabled, roleSelectClassName } =
    props;

  const isOrgAdmin = portalRole === "orgAdmin";

  const handleRoleChange = (raw: string) => {
    const role = raw as EmployeePortalRoleId;
    onPortalRoleChange(role);
    if (role === "accountant") {
      onLevelsChange(buildAccountantPermissionPreset());
    } else if (role === "orgAdmin") {
      onLevelsChange(buildOrgAdminPermissionPreset());
    }
  };

  const applyPreset = (preset: "accountant" | "employee" | "read_all" | "none_all") => {
    onLevelsChange(applyPermissionPreset(preset));
  };

  const setAll = (level: PortalAccessLevel) => {
    const next = { ...levels };
    for (const mod of PORTAL_PERMISSION_MODULES) {
      next[mod.id] = level;
    }
    onLevelsChange(next);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Role v portálu
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
              Předvolby
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

          <div className="rounded-md border border-slate-200 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-black">Oprávnění modulů</p>
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
            <div className="hidden grid-cols-[1fr_auto] gap-2 border-b border-slate-100 pb-2 text-xs font-medium text-slate-500 sm:grid">
              <span>Sekce</span>
              <span className="w-[168px] text-right">Přístup</span>
            </div>
            <ul className="mt-2 max-h-[min(420px,50vh)] space-y-2 overflow-y-auto pr-1">
              {PORTAL_PERMISSION_MODULES.map((mod) => (
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
                  </div>
                  <Select
                    disabled={disabled}
                    value={levels[mod.id as PortalModuleId]}
                    onValueChange={(v) =>
                      onLevelsChange({
                        ...levels,
                        [mod.id]: v as PortalAccessLevel,
                      })
                    }
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
