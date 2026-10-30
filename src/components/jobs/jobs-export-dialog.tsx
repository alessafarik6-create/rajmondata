"use client";

import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  JOBS_ADVANCED_EXPORT_COLUMNS,
  type JobsAdvancedExportColumnKey,
  filterExportColumns,
} from "@/lib/jobs/jobs-list-advanced-export";
import { jobStatusLabel, type JobStatusFilterKey } from "@/lib/job-status";

export type JobsExportScope = "filtered" | "selected";

export function JobsExportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filteredCount: number;
  selectedCount: number;
  statusFilter: JobStatusFilterKey;
  includeFinance: boolean;
  includeContact: boolean;
  exporting: boolean;
  onExport: (params: {
    scope: JobsExportScope;
    format: "xlsx" | "csv" | "pdf" | "print";
    columns: JobsAdvancedExportColumnKey[];
  }) => void;
}) {
  const [scope, setScope] = useState<JobsExportScope>("filtered");
  const [columns, setColumns] = useState<JobsAdvancedExportColumnKey[]>(
    JOBS_ADVANCED_EXPORT_COLUMNS.map((c) => c.key)
  );

  const visibleColumns = useMemo(
    () =>
      filterExportColumns(columns, {
        includeFinance: props.includeFinance,
        includeContact: props.includeContact,
      }),
    [columns, props.includeFinance, props.includeContact]
  );

  const count =
    scope === "selected" ? props.selectedCount : props.filteredCount;

  const statusLabel =
    props.statusFilter === "all"
      ? "všech filtrovaných"
      : jobStatusLabel(
          props.statusFilter === "new"
            ? "nová"
            : props.statusFilter === "in_progress"
              ? "rozpracovaná"
              : props.statusFilter === "waiting"
                ? "čekající"
                : props.statusFilter === "paused"
                  ? "pozastavená"
                  : props.statusFilter === "completed"
                    ? "dokončená"
                    : props.statusFilter === "cancelled"
                      ? "zrušená"
                      : "nová"
        );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export zakázek</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Export respektuje aktivní filtry (stav, typ, zaměstnanec, data založení a
            realizace).
          </p>

          <div className="space-y-2">
            <Label>Rozsah</Label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="export-scope"
                checked={scope === "filtered"}
                onChange={() => setScope("filtered")}
              />
              Exportovat {props.filteredCount} filtrovaných zakázek
            </label>
            <label
              className={`flex items-center gap-2 ${props.selectedCount === 0 ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="export-scope"
                disabled={props.selectedCount === 0}
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
              />
              Exportovat označené ({props.selectedCount})
            </label>
          </div>

          <div className="space-y-2">
            <Label>Sloupce</Label>
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto border rounded-md p-2">
              {JOBS_ADVANCED_EXPORT_COLUMNS.map((col) => {
                if (col.finance && !props.includeFinance) return null;
                if (col.contact && !props.includeContact) return null;
                const on = columns.includes(col.key);
                return (
                  <label key={col.key} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={on}
                      onCheckedChange={() =>
                        setColumns((list) =>
                          on ? list.filter((k) => k !== col.key) : [...list, col.key]
                        )
                      }
                    />
                    {col.label}
                  </label>
                );
              })}
            </div>
          </div>

          <p className="font-medium">
            Připraveno: {count} {count === 1 ? "zakázka" : count < 5 ? "zakázky" : "zakázek"}
            {scope === "filtered" && props.statusFilter !== "all"
              ? ` (${statusLabel})`
              : ""}
          </p>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Zavřít
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={props.exporting || count === 0 || visibleColumns.length === 0}
            onClick={() =>
              props.onExport({ scope, format: "csv", columns: visibleColumns })
            }
          >
            CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={props.exporting || count === 0 || visibleColumns.length === 0}
            onClick={() =>
              props.onExport({ scope, format: "xlsx", columns: visibleColumns })
            }
          >
            Excel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={props.exporting || count === 0}
            onClick={() =>
              props.onExport({ scope, format: "print", columns: visibleColumns })
            }
          >
            Tisk
          </Button>
          <Button
            type="button"
            className="bg-orange-600 hover:bg-orange-700 text-white"
            disabled={props.exporting || count === 0}
            onClick={() =>
              props.onExport({ scope, format: "pdf", columns: visibleColumns })
            }
          >
            {props.exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
