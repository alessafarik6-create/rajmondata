"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PortalAccessLevel } from "@/lib/portal-permissions";
import type { CalendarSubPermissionKey } from "@/lib/calendar/calendar-access";
import { cn } from "@/lib/utils";

const ACCESS_LABELS: Record<PortalAccessLevel, string> = {
  none: "Bez přístupu",
  read: "Náhled",
  write: "Zápis",
};

const ROWS: { key: CalendarSubPermissionKey; label: string }[] = [
  { key: "meetings", label: "Schůzky" },
  { key: "installations", label: "Montáže" },
];

export function EmployeeCalendarPermissionsBlock(props: {
  levels: Record<CalendarSubPermissionKey, PortalAccessLevel>;
  onChange: (levels: Record<CalendarSubPermissionKey, PortalAccessLevel>) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { levels, onChange, disabled, className } = props;

  return (
    <li className={cn("rounded-md border border-slate-200 bg-slate-50/80 p-3", className)}>
      <p className="text-sm font-semibold text-slate-900">Kalendář</p>
      <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
        {ROWS.map((row) => (
          <li
            key={row.key}
            className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <Label className="text-sm font-medium text-slate-800">{row.label}</Label>
            <Select
              disabled={disabled}
              value={levels[row.key]}
              onValueChange={(v) =>
                onChange({
                  ...levels,
                  [row.key]: v as PortalAccessLevel,
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
    </li>
  );
}
