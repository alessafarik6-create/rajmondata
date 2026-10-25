"use client";

import React, { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search } from "lucide-react";
import {
  filterEmployeesForAssignment,
  formatEmployeeDisplayName,
} from "@/lib/employee-active";

type Emp = {
  id: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  position?: string;
};

export function JobCreateEmployeePicker(props: {
  employees: Emp[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { employees, selectedIds, onChange } = props;
  const [search, setSearch] = useState("");
  const set = useMemo(() => new Set(selectedIds), [selectedIds]);

  const list = useMemo(() => {
    const base = filterEmployeesForAssignment(employees);
    const q = search.trim().toLowerCase();
    return base.filter((e) => {
      if (!q) return true;
      const label = formatEmployeeDisplayName(e, e.id).toLowerCase();
      return label.includes(q);
    });
  }, [employees, search]);

  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <div className="space-y-2 col-span-2 border-t pt-4">
      <p className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
        Pracovníci zakázky (volitelné)
      </p>
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Hledat zaměstnance…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ul className="max-h-40 overflow-y-auto rounded-md border divide-y">
        {list.length === 0 ? (
          <li className="p-3 text-xs text-muted-foreground">Žádní aktivní zaměstnanci.</li>
        ) : (
          list.map((e) => (
            <li key={e.id} className="flex items-center gap-2 p-2">
              <Checkbox
                id={`new-job-emp-${e.id}`}
                checked={set.has(e.id)}
                onCheckedChange={() => toggle(e.id)}
              />
              <Label htmlFor={`new-job-emp-${e.id}`} className="cursor-pointer flex-1 font-normal">
                {formatEmployeeDisplayName(e, e.id)}
                {e.jobTitle || e.position ? (
                  <span className="text-muted-foreground text-xs ml-1">
                    · {String(e.jobTitle ?? e.position)}
                  </span>
                ) : null}
              </Label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
