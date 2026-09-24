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
import { Checkbox } from "@/components/ui/checkbox";
import { normalizeCameraPermissionsForFirestore } from "@/lib/hikvision/camera-access";
import {
  ALL_PORTAL_MODULE_IDS,
  applyPermissionPreset,
  buildLegacyEmployeePermissionPreset,
  emptyPermissionMap,
  PORTAL_PERMISSION_MODULES,
  serializePortalModulePermissionsFullForFirestore,
  type PortalAccessLevel,
  type PortalModuleId,
  type PortalPermissionPresetId,
} from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";
import { EmployeeCalendarPermissionsBlock } from "@/components/employees/employee-calendar-permissions-block";
import {
  aggregateScheduleModuleLevel,
  initialCalendarPermissionsForEmployee,
  normalizeCalendarPermissionsForFirestore,
  type CalendarSubPermissionKey,
} from "@/lib/calendar/calendar-access";

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
  onSave: (payload: {
    permissions: Record<string, string>;
    cameraPermissions: ReturnType<typeof normalizeCameraPermissionsForFirestore>;
    calendarPermissions: ReturnType<typeof normalizeCalendarPermissionsForFirestore>;
  }) => Promise<void>;
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

  const initialCalendar = useMemo(
    () =>
      initialCalendarPermissionsForEmployee(employeeDoc, initial.schedule ?? "none"),
    [employeeDoc, initial]
  );
  const [calendarLevels, setCalendarLevels] =
    useState<Record<CalendarSubPermissionKey, PortalAccessLevel>>(initialCalendar);

  const initialCamera = useMemo(() => {
    const raw = employeeDoc?.cameraPermissions;
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      return {
        view: o.view === true,
        live: o.live === true,
        playback: o.playback === true,
        control: o.control === true,
        admin: o.admin === true,
      };
    }
    return { view: false, live: false, playback: false, control: false, admin: false };
  }, [employeeDoc]);

  const [cameraFlags, setCameraFlags] = useState(initialCamera);

  useEffect(() => {
    if (open) {
      setLevels(initial);
      setCalendarLevels(initialCalendar);
      setCameraFlags(initialCamera);
    }
  }, [open, initial, initialCalendar, initialCamera]);

  const applyPreset = (preset: PortalPermissionPresetId) => {
    const next = applyPermissionPreset(preset);
    setLevels(next);
    setCalendarLevels(initialCalendarPermissionsForEmployee(null, next.schedule ?? "none"));
  };

  const setAll = (level: PortalAccessLevel) => {
    const m = emptyPermissionMap();
    for (const id of ALL_PORTAL_MODULE_IDS) m[id] = level;
    setLevels(m);
    setCalendarLevels({ meetings: level, installations: level });
  };

  const moduleRows = PORTAL_PERMISSION_MODULES.filter((m) => m.id !== "schedule");

  const handleSave = async () => {
    const cameraPermissions = normalizeCameraPermissionsForFirestore(cameraFlags);
    const calendarPermissions = normalizeCalendarPermissionsForFirestore(calendarLevels);
    const levelsWithSchedule = {
      ...levels,
      schedule: aggregateScheduleModuleLevel(calendarLevels),
    };
    const permissions = serializePortalModulePermissionsFullForFirestore(levelsWithSchedule);
    if (cameraPermissions?.view) {
      permissions.cameras = permissions.cameras === "none" ? "read" : permissions.cameras;
    } else if (cameraPermissions?.admin) {
      permissions.cameras = "write";
    } else if (!cameraPermissions?.view && !cameraPermissions?.admin) {
      permissions.cameras = "none";
    }
    await onSave({ permissions, cameraPermissions, calendarPermissions });
  };

  const setCameraFlag = (key: keyof typeof cameraFlags, checked: boolean) => {
    setCameraFlags((prev) => {
      const next = { ...prev, [key]: checked };
      if (key === "admin" && checked) {
        next.view = true;
        next.live = true;
        next.playback = true;
        next.control = true;
      }
      if (key === "view" && !checked) {
        next.live = false;
        next.playback = false;
        next.control = false;
      }
      if ((key === "live" || key === "playback" || key === "control") && checked) {
        next.view = true;
      }
      return next;
    });
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
          <EmployeeCalendarPermissionsBlock
            levels={calendarLevels}
            onChange={(cal) => {
              setCalendarLevels(cal);
              setLevels((prev) => ({
                ...prev,
                schedule: aggregateScheduleModuleLevel(cal),
              }));
            }}
          />
          {moduleRows.map((mod) => (
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

        <div className="space-y-3 border-t border-slate-200 pt-3">
          <p className="text-sm font-medium text-slate-900">Kamery</p>
          <p className="text-xs text-slate-600">
            Hikvision monitoring — detailní oprávnění k živému obrazu a správě NVR.
          </p>
          <ul className="space-y-2">
            {(
              [
                ["view", "Zobrazit kamery", "Seznam kamer a snapshoty."],
                ["live", "Živý obraz", "Sledování live streamu."],
                ["playback", "Záznamy", "Historické záznamy."],
                ["control", "PTZ / ovládání", "Aktivní ovládání kamery (PTZ)."],
                ["admin", "Správa kamer", "Integrace Hikvision a synchronizace."],
              ] as const
            ).map(([key, label, hint]) => (
              <li key={key} className="flex items-start gap-2">
                <Checkbox
                  id={`cam-perm-${key}`}
                  checked={cameraFlags[key]}
                  disabled={
                    busy ||
                    (key !== "view" && key !== "admin" && !cameraFlags.view && !cameraFlags.admin)
                  }
                  onCheckedChange={(v) => setCameraFlag(key, v === true)}
                />
                <div className="grid gap-0.5 leading-none">
                  <label htmlFor={`cam-perm-${key}`} className="text-sm font-medium cursor-pointer">
                    {label}
                  </label>
                  <span className="text-[11px] text-slate-600">{hint}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

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
