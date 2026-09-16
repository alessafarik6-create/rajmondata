"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldAlert, Loader2 } from "lucide-react";
import {
  ALL_PORTAL_MODULE_IDS,
  applyPermissionPreset,
  buildLegacyEmployeePermissionPreset,
  emptyPermissionMap,
  PORTAL_PERMISSION_MODULES,
  serializePortalModulePermissionsForFirestore,
  type PortalAccessLevel,
  type PortalModuleId,
  type PortalPermissionPresetId,
} from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";

const ACCESS_LABELS: Record<PortalAccessLevel, string> = {
  none: "Bez přístupu",
  read: "Náhled",
  write: "Zápis",
};

export function EmployeePortalPermissionsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeDoc: Record<string, unknown> | null;
  userRoleLabel?: string;
  busy?: boolean;
  onSave: (permissions: Record<string, string>) => Promise<void>;
}) {
  const { open, onOpenChange, employeeName, employeeDoc, userRoleLabel, busy, onSave } = props;

  const initial = useMemo(() => {
    const raw = employeeDoc?.portalModulePermissions;
    if (raw && typeof raw === "object" && Object.keys(raw as object).length > 0) {
      const m = emptyPermissionMap();
      for (const id of ALL_PORTAL_MODULE_IDS) {
        const v = String((raw as Record<string, unknown>)[id] ?? "").trim().toLowerCase();
        if (v === "read" || v === "write" || v === "none") m[id] = v;
      }
      return m;
    }
    return buildLegacyEmployeePermissionPreset(employeeDoc);
  }, [employeeDoc]);

  const [levels, setLevels] = useState(initial);

  useEffect(() => {
    if (open) setLevels(initial);
  }, [open, initial]);

  const applyPreset = (preset: PortalPermissionPresetId) => {
    setLevels(applyPermissionPreset(preset));
  };

  const setAll = (level: PortalAccessLevel) => {
    const m = emptyPermissionMap();
    for (const id of ALL_PORTAL_MODULE_IDS) m[id] = level;
    setLevels(m);
  };

  const handleSave = async () => {
    await onSave(serializePortalModulePermissionsForFirestore(levels));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white text-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Oprávnění — {employeeName}</DialogTitle>
          <DialogDescription>
            Přístup k sekcím portálu pro tuto organizaci. WRITE zahrnuje READ; NONE skryje sekci v
            menu.
          </DialogDescription>
        </DialogHeader>

        {userRoleLabel ? (
          <p className="text-sm text-slate-600">
            Účet portálu: <span className="font-medium text-slate-900">{userRoleLabel}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("accountant")}>
            Účetní
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("employee")}>
            Zaměstnanec (výchozí)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("read_all")}>
            Vše pouze náhled
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset("none_all")}>
            Vše bez přístupu
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          <span>Nastavit vše na:</span>
          {(["none", "read", "write"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className="underline hover:text-slate-900"
              onClick={() => setAll(l)}
            >
              {ACCESS_LABELS[l]}
            </button>
          ))}
        </div>

        <ul className="space-y-3 border-t border-slate-200 pt-3">
          {PORTAL_PERMISSION_MODULES.map((mod) => (
            <li
              key={mod.id}
              className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <Label className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                  {mod.label}
                  {mod.sensitive ? (
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-label="Citlivá data" />
                  ) : null}
                </Label>
                {mod.sensitive ? (
                  <p className="text-[11px] text-amber-800/90">Citlivá data</p>
                ) : null}
              </div>
              <Select
                value={levels[mod.id as PortalModuleId]}
                onValueChange={(v) =>
                  setLevels((prev) => ({
                    ...prev,
                    [mod.id]: v as PortalAccessLevel,
                  }))
                }
              >
                <SelectTrigger className={cn("w-full sm:w-[168px] border-slate-300")}>
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button type="button" disabled={busy} onClick={() => void handleSave()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit oprávnění"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
