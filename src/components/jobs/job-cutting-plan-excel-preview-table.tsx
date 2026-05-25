"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CUTTING_PLAN_PREVIEW_MAX_HEIGHT_PX } from "@/lib/job-cutting-plan-excel-constants";
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
  const overridesKey = useMemo(() => JSON.stringify(cellOverrides), [cellOverrides]);
  const rowsKey = useMemo(() => JSON.stringify(rows), [rows]);
  const formulasKey = useMemo(() => JSON.stringify(formulaCells), [formulaCells]);

  const [grid, setGrid] = useState<GridCellModel[][]>(() =>
    buildGridModels({ rows, formulaCells, cellOverrides, canEdit })
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    setGrid(buildGridModels({ rows, formulaCells, cellOverrides, canEdit }));
    setEditingKey(null);
  }, [rowsKey, formulasKey, overridesKey, canEdit, rows, formulaCells, cellOverrides]);

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
      if (!cell || cell.isFormula || !cell.editable) return prev;
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
        className="overflow-auto overscroll-contain"
        style={{ maxHeight: CUTTING_PLAN_PREVIEW_MAX_HEIGHT_PX }}
      >
        <table className="min-w-full border-collapse text-left text-sm text-gray-900">
          <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
            <tr>
              <th className="sticky left-0 z-20 w-10 border border-gray-200 bg-gray-100 px-1 py-1 text-center text-xs text-gray-500" />
              {columnLabels.map((label) => (
                <th
                  key={label}
                  className="min-w-[5rem] border border-gray-200 px-2 py-1 text-center text-xs font-medium text-gray-600"
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
                className={cn(ri === 0 && "bg-orange-50/60", ri % 2 === 1 && ri > 0 && "bg-gray-50/30")}
              >
                <td className="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-1 py-1 text-center text-xs text-gray-500 tabular-nums">
                  {ri + 1}
                </td>
                {line.map((cell) => {
                  const key = cellKey(cell.row, cell.col);
                  const isEditing = editingKey === key;
                  const inputValue =
                    cell.override !== undefined ? cell.override : cell.base;

                  return (
                    <td
                      key={key}
                      className={cn(
                        "border border-gray-200 p-0 align-middle min-w-[5rem]",
                        cell.isFormula && "bg-sky-50",
                        cell.editable && "bg-amber-50/50"
                      )}
                      title={
                        cell.isFormula
                          ? `Vzorec: ${cell.formula}`
                          : cell.editable
                            ? "Klikněte pro úpravu"
                            : undefined
                      }
                    >
                      {cell.isFormula ? (
                        <div
                          className="min-h-[2rem] px-2 py-1.5 tabular-nums text-gray-900 whitespace-nowrap"
                          aria-readonly
                        >
                          {cell.display !== "" ? cell.display : "\u00a0"}
                          {cell.formulaError ? (
                            <span
                              className="ml-1 text-[10px] text-amber-700"
                              title={cell.formulaError}
                            >
                              ?
                            </span>
                          ) : null}
                        </div>
                      ) : cell.editable ? (
                        <input
                          ref={(el) => {
                            inputRefs.current[key] = el;
                          }}
                          type="text"
                          value={inputValue}
                          readOnly={!canEdit}
                          onFocus={() => setEditingKey(key)}
                          onBlur={() => setEditingKey((k) => (k === key ? null : k))}
                          onChange={(e) => updateCell(cell.row, cell.col, e.target.value)}
                          className={cn(
                            "w-full min-h-[2rem] min-w-[5rem] border-0 bg-transparent px-2 py-1.5 text-sm text-gray-900",
                            "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-inset",
                            isEditing && "bg-white ring-1 ring-primary/30"
                          )}
                        />
                      ) : (
                        <div className="min-h-[2rem] px-2 py-1.5 whitespace-nowrap text-gray-800">
                          {cell.display || "\u00a0"}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
