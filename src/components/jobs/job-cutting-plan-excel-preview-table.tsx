"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CUTTING_PLAN_PREVIEW_MAX_HEIGHT_PX } from "@/lib/job-cutting-plan-excel-constants";
import { CuttingPlanPreviewEngine } from "@/lib/job-cutting-plan-excel-hyperformula";
import { cellKey } from "@/lib/job-cutting-plan-excel-storage";

export type PreviewTableDraft = {
  overrides: Record<string, string>;
  computedValues: Record<string, string>;
  rows: string[][];
};

type Props = {
  sheetName: string;
  rows: string[][];
  formulaCells: Record<string, string>;
  cellOverrides: Record<string, string>;
  /** Změna dat ze serveru — při editaci se nemění. */
  syncKey: string;
  canEdit: boolean;
  onDraftChange?: (draft: PreviewTableDraft) => void;
};

export function JobCuttingPlanExcelPreviewTable(props: Props) {
  const {
    sheetName,
    rows,
    formulaCells,
    cellOverrides,
    syncKey,
    canEdit,
    onDraftChange,
  } = props;

  const engineRef = useRef<CuttingPlanPreviewEngine | null>(null);
  const [displays, setDisplays] = useState<string[][]>([]);
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [focusedValue, setFocusedValue] = useState<string>("");

  const rowCount = rows.length;
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);

  const rebuildFromProps = useCallback(() => {
    engineRef.current?.destroy();
    if (rowCount === 0 || colCount === 0) {
      engineRef.current = null;
      setDisplays([]);
      setLocalOverrides({ ...cellOverrides });
      return;
    }
    const engine = CuttingPlanPreviewEngine.create({
      rows,
      formulaCells,
      cellOverrides,
    });
    engineRef.current = engine;
    setLocalOverrides({ ...cellOverrides });
    setDisplays(engine.getAllDisplays());
  }, [rows, formulaCells, cellOverrides, rowCount, colCount]);

  useEffect(() => {
    rebuildFromProps();
    return () => engineRef.current?.destroy();
    // Pouze syncKey — změny draftOverrides nesmí znovu sestavit grid při psaní.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const emitDraft = useCallback(
    (nextOverrides: Record<string, string>) => {
      const engine = engineRef.current;
      if (!engine) return;
      onDraftChange?.({
        overrides: nextOverrides,
        computedValues: engine.getComputedValues(),
        rows: engine.getAllDisplays(),
      });
    },
    [onDraftChange]
  );

  const getInputValue = (row: number, col: number): string => {
    const key = cellKey(row, col);
    if (Object.prototype.hasOwnProperty.call(localOverrides, key)) {
      return localOverrides[key];
    }
    return String(rows[row]?.[col] ?? "");
  };

  const commitCell = (row: number, col: number, value: string) => {
    const engine = engineRef.current;
    if (!engine || !canEdit || !engine.isEditable(row, col)) return;

    const key = cellKey(row, col);
    const nextOverrides = { ...localOverrides, [key]: value };
    engine.setCellValue(row, col, value);
    setLocalOverrides(nextOverrides);
    setDisplays(engine.getAllDisplays());
    emitDraft(nextOverrides);
  };

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

  if (rowCount === 0 || colCount === 0) return null;

  const engine = engineRef.current;

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
                  className="min-w-[5.5rem] border border-gray-200 px-2 py-1 text-center text-xs font-medium text-gray-600"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displays.map((line, ri) => (
              <tr
                key={`row-${ri}`}
                className={cn(ri === 0 && "bg-orange-50/60", ri % 2 === 1 && ri > 0 && "bg-gray-50/30")}
              >
                <td className="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-1 py-1 text-center text-xs text-gray-500 tabular-nums">
                  {ri + 1}
                </td>
                {Array.from({ length: colCount }, (_, ci) => {
                  const key = cellKey(ri, ci);
                  const isFormula = engine?.isFormulaCell(ri, ci) ?? false;
                  const editable = canEdit && (engine?.isEditable(ri, ci) ?? !isFormula);
                  const display = line[ci] ?? "";
                  const isEditing = editingKey === key;

                  return (
                    <td
                      key={key}
                      className={cn(
                        "border border-gray-200 p-0 align-middle",
                        isFormula ? "bg-sky-50" : editable ? "bg-amber-50/60" : "bg-white"
                      )}
                      onClick={() => {
                        if (editable && !isEditing) {
                          const v = getInputValue(ri, ci);
                          setFocusedValue(v);
                          setEditingKey(key);
                        }
                      }}
                    >
                      {isFormula ? (
                        <div
                          className="min-h-[2.25rem] px-2 py-1.5 tabular-nums text-gray-900 whitespace-nowrap"
                          title={
                            formulaCells[key]
                              ? `Vzorec: ${formulaCells[key]}`
                              : undefined
                          }
                        >
                          {display || (rows[ri]?.[ci] && !String(rows[ri][ci]).startsWith("=") ? rows[ri][ci] : "\u00a0")}
                        </div>
                      ) : editable ? (
                        isEditing ? (
                          <input
                            autoFocus
                            type="text"
                            value={focusedValue}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFocusedValue(v);
                              commitCell(ri, ci, v);
                            }}
                            onBlur={() => {
                              commitCell(ri, ci, focusedValue);
                              setEditingKey(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitCell(ri, ci, focusedValue);
                                setEditingKey(null);
                              }
                              if (e.key === "Escape") {
                                setEditingKey(null);
                              }
                            }}
                            className="w-full min-h-[2.25rem] min-w-[5.5rem] border-0 bg-white px-2 py-1.5 text-sm text-gray-900 caret-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        ) : (
                          <div className="min-h-[2.25rem] cursor-text px-2 py-1.5 tabular-nums text-gray-900 whitespace-nowrap">
                            {Object.prototype.hasOwnProperty.call(localOverrides, key)
                              ? localOverrides[key]
                              : display || rows[ri]?.[ci] || "\u00a0"}
                          </div>
                        )
                      ) : (
                        <div className="min-h-[2.25rem] px-2 py-1.5 whitespace-nowrap text-gray-800">
                          {display || "\u00a0"}
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
