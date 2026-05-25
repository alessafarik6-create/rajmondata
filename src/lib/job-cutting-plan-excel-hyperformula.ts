/**
 * Přepočet náhledu přes HyperFormula (client-only).
 */

import { HyperFormula, type RawCellContent } from "hyperformula";
import { cellKey } from "@/lib/job-cutting-plan-excel-storage";

const HF_OPTIONS = {
  licenseKey: "gpl-v3" as const,
  useColumnIndex: true,
};

export function coerceToNumber(raw: string): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.startsWith("#")) return null;
  const normalized = s.replace(/\s+/g, "").replace(/(\d),(\d)/g, "$1.$2").replace(/,/g, ".");
  const direct = Number(normalized);
  if (Number.isFinite(direct) && /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(normalized)) {
    return direct;
  }
  const m = normalized.match(/-?\d+(?:\.\d+)?/);
  if (m) {
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeFormula(f: string): string {
  let expr = f.trim();
  if (!expr.startsWith("=")) expr = `=${expr}`;
  return expr.replace(/\bSUMA\b/gi, "SUM").replace(/;/g, ",");
}

function toRawContent(value: string, isFormula: boolean): RawCellContent {
  if (isFormula) return normalizeFormula(value);
  const t = value.trim();
  if (!t) return null;
  const n = coerceToNumber(t);
  if (n != null) return n;
  return t;
}

function isFormulaError(val: unknown): boolean {
  return (
    val != null &&
    typeof val === "object" &&
    ("type" in (val as object) || "message" in (val as object))
  );
}

export function formatHyperFormulaValue(val: unknown): string | null {
  if (val == null || val === "") return "";
  if (isFormulaError(val)) return null;
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return null;
    const rounded = Math.round(val * 1e6) / 1e6;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }
  if (typeof val === "boolean") return val ? "Ano" : "Ne";
  return String(val);
}

export type CuttingPlanEngineState = {
  rowCount: number;
  colCount: number;
  formulaCells: Record<string, string>;
  fallbackValues: Record<string, string>;
};

export class CuttingPlanPreviewEngine {
  private hf: HyperFormula;
  readonly rowCount: number;
  readonly colCount: number;
  readonly formulaCells: Record<string, string>;
  private readonly formulaSet: Set<string>;
  private readonly fallbackValues: Record<string, string>;

  private constructor(
    hf: HyperFormula,
    rowCount: number,
    colCount: number,
    formulaCells: Record<string, string>,
    fallbackValues: Record<string, string>
  ) {
    this.hf = hf;
    this.rowCount = rowCount;
    this.colCount = colCount;
    this.formulaCells = formulaCells;
    this.formulaSet = new Set(Object.keys(formulaCells));
    this.fallbackValues = fallbackValues;
  }

  static create(params: {
    rows: string[][];
    formulaCells: Record<string, string>;
    cellOverrides: Record<string, string>;
  }): CuttingPlanPreviewEngine {
    const rowCount = params.rows.length;
    const colCount = params.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const formulaCells = { ...params.formulaCells };
    const fallbackValues: Record<string, string> = {};

    const data: RawCellContent[][] = [];
    for (let r = 0; r < rowCount; r++) {
      const line: RawCellContent[] = [];
      for (let c = 0; c < colCount; c++) {
        const key = cellKey(r, c);
        const base = String(params.rows[r]?.[c] ?? "");
        fallbackValues[key] = base;

        const formula = formulaCells[key]?.trim();
        if (formula) {
          line.push(toRawContent(formula, true));
          continue;
        }
        if (base.startsWith("=")) {
          formulaCells[key] = normalizeFormula(base);
          line.push(toRawContent(formulaCells[key], true));
          continue;
        }

        const override = Object.prototype.hasOwnProperty.call(params.cellOverrides, key)
          ? params.cellOverrides[key]
          : undefined;
        const val = override !== undefined ? override : base;
        line.push(toRawContent(val, false));
      }
      data.push(line);
    }

    const hf = HyperFormula.buildFromArray(data, HF_OPTIONS);
    return new CuttingPlanPreviewEngine(hf, rowCount, colCount, formulaCells, fallbackValues);
  }

  isFormulaCell(row: number, col: number): boolean {
    return this.formulaSet.has(cellKey(row, col));
  }

  isEditable(row: number, col: number): boolean {
    return !this.isFormulaCell(row, col);
  }

  getCellDisplay(row: number, col: number): string {
    if (row < 0 || col < 0 || row >= this.rowCount || col >= this.colCount) return "";
    const key = cellKey(row, col);
    const fallbackDisplay = (): string => {
      const fb = this.fallbackValues[key];
      if (fb && !fb.startsWith("=") && fb !== "?") return fb;
      return fb && fb !== "?" ? fb : "";
    };
    try {
      const val = this.hf.getCellValue({ sheet: 0, row, col });
      const formatted = formatHyperFormulaValue(val);
      if (formatted !== null && formatted !== "") return formatted;
      if (this.isFormulaCell(row, col)) {
        if (isFormulaError(val)) {
          console.warn(
            "[CuttingPlanPreviewEngine] formula not supported",
            key,
            this.formulaCells[key],
            val
          );
        }
        const fb = fallbackDisplay();
        if (fb) return fb;
        return formatted ?? "";
      }
      if (isFormulaError(val)) {
        console.warn("[CuttingPlanPreviewEngine] cell error", key, val);
        return fallbackDisplay();
      }
      return formatted ?? "";
    } catch (e) {
      console.warn("[CuttingPlanPreviewEngine] getCellValue", key, e);
      return fallbackDisplay();
    }
  }

  getAllDisplays(): string[][] {
    const out: string[][] = [];
    for (let r = 0; r < this.rowCount; r++) {
      const line: string[] = [];
      for (let c = 0; c < this.colCount; c++) {
        line.push(this.getCellDisplay(r, c));
      }
      out.push(line);
    }
    return out;
  }

  getComputedValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of this.formulaSet) {
      const m = key.match(/^r(\d+)c(\d+)$/);
      if (!m) continue;
      const r = parseInt(m[1], 10);
      const c = parseInt(m[2], 10);
      out[key] = this.getCellDisplay(r, c);
    }
    return out;
  }

  setCellValue(row: number, col: number, value: string): void {
    if (!this.isEditable(row, col)) return;
    const content = toRawContent(value, false);
    try {
      this.hf.setCellContents({ sheet: 0, row, col }, [[content]]);
    } catch (e) {
      console.warn("[CuttingPlanPreviewEngine] setCellContents failed", cellKey(row, col), e);
      try {
        this.hf.setCellContents({ sheet: 0, row, col }, [[value]]);
      } catch (e2) {
        console.warn("[CuttingPlanPreviewEngine] setCellContents text fallback", e2);
      }
    }
  }

  destroy(): void {
    try {
      this.hf.destroy();
    } catch {
      /* ignore */
    }
  }
}
