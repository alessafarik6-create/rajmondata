/**
 * Přepočet Excel vzorců v náhledu — odkazy A1, rozsahy, SUM/SUMA, + − × ÷.
 */

import { cellKey } from "@/lib/job-cutting-plan-excel-storage";

export type GridValueGetter = (row: number, col: number) => string;

const CELL_REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/gi;
const RANGE_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+):(\$?)([A-Z]{1,3})(\$?)(\d+)/gi;

function colLettersToIndex(letters: string): number {
  let n = 0;
  const u = letters.toUpperCase();
  for (let i = 0; i < u.length; i++) {
    n = n * 26 + (u.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = ref.replace(/\$/g, "").trim().match(/^([A-Z]{1,3})(\d+)$/i);
  if (!m) return null;
  const row = parseInt(m[2], 10) - 1;
  const col = colLettersToIndex(m[1]);
  if (row < 0 || col < 0) return null;
  return { row, col };
}

/** Číslo z textu pro výpočet — „150 mm“, „1 234,5 Kč“, „12.5“. */
export function coerceToNumber(raw: string): number {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.startsWith("#")) return 0;

  const normalized = s
    .replace(/\s+/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/,/g, ".");

  const direct = Number(normalized);
  if (Number.isFinite(direct) && /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(normalized)) {
    return direct;
  }

  const m = normalized.match(/-?\d+(?:\.\d+)?/);
  if (m) {
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function getNumeric(get: GridValueGetter, row: number, col: number): number {
  return coerceToNumber(get(row, col));
}

function sumRange(get: GridValueGetter, from: string, to: string): number {
  const a = parseCellRef(from);
  const b = parseCellRef(to);
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

function normalizeFormulaBody(expr: string): string {
  return expr
    .replace(/\r\n/g, " ")
    .replace(/\u00d7/g, "*")
    .replace(/\u00f7/g, "/")
    .replace(/\bSUMA\b/gi, "SUM")
    .replace(/;/g, ",")
    .trim();
}

/** Nahradí SUM(…) včetně vnořených závorek. */
function replaceSumCalls(expr: string, get: GridValueGetter): string {
  let work = expr;
  const sumRe = /\bSUM\s*\(/gi;
  let guard = 0;
  while (guard++ < 50) {
    const m = sumRe.exec(work);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let i = open + 1;
    for (; i < work.length && depth > 0; i++) {
      if (work[i] === "(") depth++;
      else if (work[i] === ")") depth--;
    }
    if (depth !== 0) break;
    const inner = work.slice(open + 1, i - 1);
    const value = evalSumArgs(inner, get);
    work = work.slice(0, m.index) + String(value) + work.slice(i);
    sumRe.lastIndex = 0;
  }
  return work;
}

function evalSumArgs(inner: string, get: GridValueGetter): number {
  const parts = splitTopLevelArgs(inner);
  let sum = 0;
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes(":")) {
      const [from, to] = p.split(":").map((x) => x.trim());
      if (from && to) sum += sumRange(get, from, to);
      continue;
    }
    const ref = parseCellRef(p);
    if (ref) sum += getNumeric(get, ref.row, ref.col);
    else sum += coerceToNumber(p);
  }
  return sum;
}

function splitTopLevelArgs(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function replaceRanges(expr: string, get: GridValueGetter): string {
  return expr.replace(RANGE_RE, (_m, _a1, c1, _a2, r1, _b1, c2, _b2, r2) => {
    const from = `${c1}${r1}`;
    const to = `${c2}${r2}`;
    return String(sumRange(get, from, to));
  });
}

function replaceSingleRefs(expr: string, get: GridValueGetter): string {
  return expr.replace(CELL_REF_RE, (match) => {
    if (match.includes(":")) return match;
    const p = parseCellRef(match);
    if (!p) return "0";
    return String(getNumeric(get, p.row, p.col));
  });
}

function normalizeDecimalLiterals(expr: string): string {
  return expr.replace(/(\d+),(\d+)/g, "$1.$2");
}

function safeEvalArithmetic(expr: string): number | null {
  let cleaned = expr.replace(/\s/g, "");
  cleaned = normalizeDecimalLiterals(cleaned);
  if (!cleaned) return 0;
  if (!/^[\d.eE+\-*/().]+$/.test(cleaned)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${cleaned});`);
    const v = fn();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function formatComputedNumber(n: number): string {
  const rounded = Math.round(n * 1e6) / 1e6;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
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
    let work = normalizeFormulaBody(expr);
    work = replaceSumCalls(work, get);
    work = replaceRanges(work, get);
    work = replaceSingleRefs(work, get);
    work = normalizeDecimalLiterals(work);

    const num = safeEvalArithmetic(work);
    if (num != null) {
      return { value: formatComputedNumber(num) };
    }
    return { value: "", error: "Výraz nelze vyhodnotit" };
  } catch {
    return { value: "", error: "Výpočet selhal" };
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

function cellInputValue(cell: GridCellModel): string {
  if (cell.override !== undefined) return cell.override;
  return cell.base;
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
      let formula = formulaCells[key]?.trim();
      const base = String(rows[r]?.[c] ?? "");
      const hasOverride = Object.prototype.hasOwnProperty.call(cellOverrides, key);
      const override = hasOverride ? cellOverrides[key] : undefined;

      if (!formula && base.startsWith("=")) {
        formula = base;
      }

      const isFormula = !!formula;
      line.push({
        row: r,
        col: c,
        base,
        override,
        formula,
        display: base,
        isFormula,
        editable: canEdit && !isFormula,
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

  const getForFormula: GridValueGetter = (r, c) => {
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) return "";
    const cell = grid[r][c];
    if (!cell.isFormula) return cellInputValue(cell);
    return cell.display;
  };

  const maxPasses = 32;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const cell = grid[r][c];
        if (!cell.formula) {
          const next = cellInputValue(cell);
          if (cell.display !== next) {
            cell.display = next;
            changed = true;
          }
          cell.formulaError = undefined;
          continue;
        }

        const { value, error } = evaluateFormula(cell.formula, getForFormula);
        const show = value || (error ? "" : "");
        if (cell.display !== show || cell.formulaError !== error) {
          cell.display = show;
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

export function gridOverridesFromDraft(grid: GridCellModel[][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of grid) {
    for (const cell of line) {
      if (cell.override !== undefined) {
        out[cellKey(cell.row, cell.col)] = cell.override;
      }
    }
  }
  return out;
}
