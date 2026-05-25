/**
 * Jednoduchý přepočet Excel vzorců v náhledu (+, -, *, /, SUM, SUMA, odkazy na buňky).
 */

import { cellKey } from "@/lib/job-cutting-plan-excel-storage";

export type GridValueGetter = (row: number, col: number) => string;

const COL_RE = /^([A-Z]+)(\d+)$/i;

function colLettersToIndex(letters: string): number {
  let n = 0;
  const u = letters.toUpperCase();
  for (let i = 0; i < u.length; i++) {
    n = n * 26 + (u.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = ref.replace(/\$/g, "").trim().match(COL_RE);
  if (!m) return null;
  return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

function parseNumberish(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function getNumeric(get: GridValueGetter, row: number, col: number): number {
  const n = parseNumberish(get(row, col));
  return n ?? 0;
}

function evalRangeSum(
  get: GridValueGetter,
  range: string
): number {
  const parts = range.split(":").map((p) => p.trim());
  if (parts.length !== 2) return 0;
  const a = parseCellRef(parts[0]);
  const b = parseCellRef(parts[1]);
  if (!a || !b) return 0;
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  let sum = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      sum += getNumeric(get, r, c);
    }
  }
  return sum;
}

function replaceCellRefs(expr: string, get: GridValueGetter): string {
  return expr.replace(
    /(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/gi,
    (match, a, b) => {
      if (b) {
        return String(evalRangeSum(get, `${a}:${b}`));
      }
      const p = parseCellRef(a);
      if (!p) return "0";
      return String(getNumeric(get, p.row, p.col));
    }
  );
}

function replaceSumFunctions(expr: string, get: GridValueGetter): string {
  return expr.replace(
    /(SUM|SUMA)\s*\(\s*([^)]+)\s*\)/gi,
    (_m, _fn, inner) => {
      const innerTrim = String(inner).trim();
      if (innerTrim.includes(":")) {
        return String(evalRangeSum(get, innerTrim));
      }
      const parts = innerTrim.split(",").map((p) => p.trim());
      let sum = 0;
      for (const p of parts) {
        if (p.includes(":")) {
          sum += evalRangeSum(get, p);
          continue;
        }
        const ref = parseCellRef(p);
        if (ref) sum += getNumeric(get, ref.row, ref.col);
        else {
          const n = parseNumberish(p);
          if (n != null) sum += n;
        }
      }
      return String(sum);
    }
  );
}

function safeEvalArithmetic(expr: string): number | null {
  const cleaned = expr.replace(/\s/g, "");
  if (!/^[\d.+\-*/()]+$/.test(cleaned)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${cleaned});`);
    const v = fn();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function evaluateFormula(
  formula: string,
  get: GridValueGetter
): { value: string; error?: string } {
  let expr = String(formula ?? "").trim();
  if (!expr) return { value: "" };
  if (expr.startsWith("=")) expr = expr.slice(1).trim();
  if (!expr) return { value: "" };

  try {
    let work = replaceSumFunctions(expr, get);
    work = replaceCellRefs(work, get);
    const num = safeEvalArithmetic(work);
    if (num != null) {
      const rounded = Math.round(num * 1e6) / 1e6;
      return { value: String(rounded) };
    }
    return { value: "#VAL?", error: "Výraz nelze vyhodnotit" };
  } catch {
    return { value: "#CHYBA?", error: "Výpočet selhal" };
  }
}

export type GridCellModel = {
  row: number;
  col: number;
  base: string;
  override?: string;
  formula?: string;
  display: string;
  isFormula: boolean;
  editable: boolean;
  formulaError?: string;
};

function isNumericish(s: string): boolean {
  if (!s.trim()) return true;
  return parseNumberish(s) != null;
}

export function buildGridModels(params: {
  rows: string[][];
  formulaCells: Record<string, string>;
  cellOverrides: Record<string, string>;
  canEdit: boolean;
}): GridCellModel[][] {
  const { rows, formulaCells, cellOverrides, canEdit } = params;
  const rowCount = rows.length;
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const grid: GridCellModel[][] = [];

  for (let r = 0; r < rowCount; r++) {
    const line: GridCellModel[] = [];
    for (let c = 0; c < colCount; c++) {
      const key = cellKey(r, c);
      const formula = formulaCells[key]?.trim();
      const base = String(rows[r]?.[c] ?? "");
      const override = cellOverrides[key];
      const isFormula = !!formula;
      line.push({
        row: r,
        col: c,
        base,
        override,
        formula,
        display: base,
        isFormula,
        editable: canEdit && !isFormula && isNumericish(base || override || ""),
        formulaError: undefined,
      });
    }
    grid.push(line);
  }

  recalculateGrid(grid);
  return grid;
}

export function recalculateGrid(grid: GridCellModel[][]): void {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const getDisplay = (r: number, c: number): string => {
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) return "";
    return grid[r][c].display;
  };

  const maxPasses = 24;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const cell = grid[r][c];
        if (!cell.formula) {
          const next = cell.override != null ? cell.override : cell.base;
          if (cell.display !== next) {
            cell.display = next;
            changed = true;
          }
          continue;
        }
        const { value, error } = evaluateFormula(cell.formula, getDisplay);
        if (cell.display !== value || cell.formulaError !== error) {
          cell.display = value;
          cell.formulaError = error;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

export function gridToRows2d(grid: GridCellModel[][]): string[][] {
  return grid.map((line) => line.map((cell) => cell.display));
}

export function gridOverridesFromDraft(
  grid: GridCellModel[][]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of grid) {
    for (const cell of line) {
      if (cell.override != null && cell.override !== cell.base) {
        out[cellKey(cell.row, cell.col)] = cell.override;
      }
    }
  }
  return out;
}
