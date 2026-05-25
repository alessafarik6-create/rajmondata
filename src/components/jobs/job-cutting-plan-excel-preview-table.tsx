"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CUTTING_PLAN_PREVIEW_MAX_HEIGHT_PX,
} from "@/lib/job-cutting-plan-excel-constants";
import {
  buildGridModels,
  gridOverridesFromDraft,
  gridToRows2d,
  recalculateGrid,
  type GridCellModel,
} from "@/lib/job-cutting-plan-excel-formulas";
import { cellKey } from "@/lib/job-cutting-plan-excel-storage";

export type PreviewTableDraft = {
  grid: GridCellModel[][];
  overrides: Record<string, string>;
  rows: string[][];
};

type Props = {
  sheetName: string;
  rows: string[][];
  formulaCells: Record<string, string>;
  cellOverrides: Record<string, string>;
  canEdit: boolean;
  onDraftChange?: (draft: PreviewTableDraft) => void;
};

export function JobCuttingPlanExcelPreviewTable(props: Props) {
  const { sheetName, rows, formulaCells, cellOverrides, canEdit, onDraftChange } = props;

  const [grid, setGrid] = useState<GridCellModel[][]>(() =>
    buildGridModels({ rows, formulaCells, cellOverrides, canEdit })
  );

  useEffect(() => {
    setGrid(buildGridModels({ rows, formulaCells, cellOverrides, canEdit }));
  }, [rows, formulaCells, cellOverrides, canEdit]);

  const emitDraft = useCallback(
    (next: GridCellModel[][]) => {
      onDraftChange?.({
        grid: next,
        overrides: gridOverridesFromDraft(next),
        rows: gridToRows2d(next),
      });
    },
    [onDraftChange]
  );

  const updateCell = (row: number, col: number, value: string) => {
    setGrid((prev) => {
      const next = prev.map((line) => line.map((c) => ({ ...c })));
      const cell = next[row]?.[col];
      if (!cell || !cell.editable) return prev;
      cell.override = value;
      recalculateGrid(next);
      emitDraft(next);
      return next;
    });
  };

  const colCount = grid[0]?.length ?? 0;

  const columnLabels = useMemo(() => {
    const labels: string[] = [];
    for (let c = 0; c < colCount; c++) {
      let n = c;
      let s = "";
      do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      labels.push(s);
    }
    return labels;
  }, [colCount]);

  if (!grid.length) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <p className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700">
        List: {sheetName}
      </p>
      <div
        className="overflow-auto"
        style={{ maxHeight: CUTTING_PLAN_PREVIEW_MAX_HEIGHT_PX }}
      >
        <table className="min-w-full border-collapse text-left text-sm text-gray-900">
          <thead className="sticky top-0 z-10 bg-gray-100">
            <tr>
              <th className="w-10 border border-gray-200 px-1 py-1 text-center text-xs text-gray-500" />
              {columnLabels.map((label) => (
                <th
                  key={label}
                  className="min-w-[4.5rem] border border-gray-200 px-2 py-1 text-center text-xs font-medium text-gray-600"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((line, ri) => (
              <tr
                key={`row-${ri}`}
                className={cn(ri === 0 && "bg-orange-50/70", ri % 2 === 1 && ri > 0 && "bg-gray-50/40")}
              >
                <td className="border border-gray-200 bg-gray-50 px-1 py-1 text-center text-xs text-gray-500 tabular-nums">
                  {ri + 1}
                </td>
                {line.map((cell) => (
                  <td
                    key={cellKey(cell.row, cell.col)}
                    className={cn(
                      "border border-gray-200 p-0 align-top",
                      cell.isFormula && "bg-sky-50/80",
                      cell.editable && "bg-amber-50/30"
                    )}
                    title={
                      cell.isFormula
                        ? cell.formula
                        : cell.editable
                          ? "Upravitelná hodnota"
                          : undefined
                    }
                  >
                    {cell.isFormula ? (
                      <div className="px-2 py-1.5 tabular-nums whitespace-nowrap">
                        <span className="text-gray-900">{cell.display || "—"}</span>
                        {cell.formulaError ? (
                          <span className="ml-1 text-[10px] text-amber-700">!</span>
                        ) : null}
                      </div>
                    ) : cell.editable ? (
                      <Input
                        value={cell.override ?? cell.base}
                        onChange={(e) => updateCell(cell.row, cell.col, e.target.value)}
                        className="h-8 min-w-[4.5rem] rounded-none border-0 bg-transparent px-2 py-1 text-sm tabular-nums shadow-none focus-visible:ring-1 focus-visible:ring-primary"
                      />
                    ) : (
                      <div className="px-2 py-1.5 whitespace-nowrap text-gray-800">
                        {cell.display || "\u00a0"}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
