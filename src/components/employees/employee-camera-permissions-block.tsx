"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export type EmployeeCameraFlags = {
  view: boolean;
  live: boolean;
  playback: boolean;
  control: boolean;
  admin: boolean;
};

export function parseEmployeeCameraFlagsFromDoc(
  employeeDoc: Record<string, unknown> | null | undefined
): EmployeeCameraFlags {
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
}

export function EmployeeCameraPermissionsBlock(props: {
  flags: EmployeeCameraFlags;
  onChange: (flags: EmployeeCameraFlags) => void;
  disabled?: boolean;
}) {
  const { flags, onChange, disabled } = props;

  const setFlag = (key: keyof EmployeeCameraFlags, checked: boolean) => {
    onChange((() => {
      const next = { ...flags, [key]: checked };
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
    })());
  };

  const rows: { key: keyof EmployeeCameraFlags; label: string; hint?: string }[] = [
    { key: "view", label: "Zobrazit kamery" },
    { key: "live", label: "Živý náhled" },
    { key: "playback", label: "Historie záznamů" },
    { key: "control", label: "Ovládání (PTZ)" },
    { key: "admin", label: "Správa kamer", hint: "Zahrnuje živý náhled a historii." },
  ];

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-4">
      <p className="text-sm font-semibold text-black">Kamerový systém</p>
      <p className="text-xs text-slate-600">
        Doplňuje oprávnění modulu Kamery v matici portálu.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-2">
            <Checkbox
              id={`cam-${row.key}`}
              checked={flags[row.key]}
              disabled={disabled}
              onCheckedChange={(v) => setFlag(row.key, v === true)}
            />
            <div>
              <Label htmlFor={`cam-${row.key}`} className="text-sm font-medium text-slate-900">
                {row.label}
              </Label>
              {row.hint ? <p className="text-[11px] text-slate-500">{row.hint}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
