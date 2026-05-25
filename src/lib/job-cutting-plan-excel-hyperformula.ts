/**
 * Přepočet náhledu přes HyperFormula (client-only).
 */

import { HyperFormula, type RawCellContent } from "hyperformula";
import { cellKey } from "@/lib/job-cutting-plan-excel-storage";

const HF_OPTIONS = {
  licenseKey: "gpl-v3" as const,
  useColumnIndex: true,
};

const DEFAULT_SHEET_NAME = "Sheet1";
const LEGACY_SHEET_ALIASES = ["Sheet1", "Sheet 1", "List1", "List 1"];

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Odstraní prefix aktuálního listu (=Sayfa1!A1 → =A1). */
function stripSameSheetPrefix(formula: string, sheetName: string): string {
  const esc = escapeRegExp(sheetName.trim());
  if (!esc) return formula;
  return formula
    .replace(new RegExp(`'${esc}'!`, "gi"), "")
    .replace(new RegExp(`(?<![A-Za-z0-9_])${esc}!`, "gi"), "");
}

/** Odstraní prefixy výchozích anglických názvů, pokud list má jiné jméno (Sayfa1). */
function stripLegacySheetPrefixes(formula: string, actualSheetName: string): string {
  const actual = actualSheetName.trim().toLowerCase();
  let out = formula;
  for (const legacy of LEGACY_SHEET_ALIASES) {
    if (legacy.toLowerCase() === actual) continue;
    const esc = escapeRegExp(legacy);
    out = out.replace(new RegExp(`'${esc}'!`, "gi"), "");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${esc}!`, "gi"), "");
  }
  return out;
}

export function normalizeFormulaForSheet(formula: string, sheetName: string): string {
  let expr = formula.trim();
  if (!expr.startsWith("=")) expr = `=${expr}`;
  expr = expr.replace(/\bSUMA\b/gi, "SUM").replace(/;/g, ",");
  const sheet = sheetName.trim() || DEFAULT_SHEET_NAME;
  expr = stripSameSheetPrefix(expr, sheet);
  expr = stripLegacySheetPrefixes(expr, sheet);
  return expr;
}

function toRawContent(value: string, isFormula: boolean, sheetName: string): RawCellContent {
  if (isFormula) return normalizeFormulaForSheet(value, sheetName);
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

function resolveSheetName(name: string | undefined): string {
  const n = String(name ?? "").trim();
  return n || DEFAULT_SHEET_NAME;
}

export class CuttingPlanPreviewEngine {
  private hf: HyperFormula;
  readonly sheetName: string;
  readonly sheetId: number;
  readonly rowCount: number;
  readonly colCount: number;
  readonly formulaCells: Record<string, string>;
  private readonly formulaSet: Set<string>;
  private readonly fallbackValues: Record<string, string>;

  private constructor(
    hf: HyperFormula,
    sheetName: string,
    sheetId: number,
    rowCount: number,
    colCount: number,
    formulaCells: Record<string, string>,
    fallbackValues: Record<string, string>
  ) {
    this.hf = hf;
    this.sheetName = sheetName;
    this.sheetId = sheetId;
    this.rowCount = rowCount;
    this.colCount = colCount;
    this.formulaCells = formulaCells;
    this.formulaSet = new Set(Object.keys(formulaCells));
    this.fallbackValues = fallbackValues;
  }

  static create(params: {
    sheetName: string;
    rows: string[][];
    formulaCells: Record<string, string>;
    cellOverrides: Record<string, string>;
  }): CuttingPlanPreviewEngine {
    const sheetName = resolveSheetName(params.sheetName);
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

        let formula = formulaCells[key]?.trim();
        if (!formula && base.startsWith("=")) {
          formula = base;
          formulaCells[key] = normalizeFormulaForSheet(formula, sheetName);
        }
        if (formula) {
          const normalized = normalizeFormulaForSheet(formula, sheetName);
          formulaCells[key] = normalized;
          line.push(normalized);
          continue;
        }

        const override = Object.prototype.hasOwnProperty.call(params.cellOverrides, key)
          ? params.cellOverrides[key]
          : undefined;
        const val = override !== undefined ? override : base;
        line.push(toRawContent(val, false, sheetName));
      }
      data.push(line);
    }

    const hf = HyperFormula.buildFromSheets({ [sheetName]: data }, HF_OPTIONS);
    const sheetId = hf.getSheetId(sheetName);
    if (sheetId === undefined) {
      throw new Error(`[CuttingPlanPreviewEngine] sheet not found: ${sheetName}`);
    }

    return new CuttingPlanPreviewEngine(
      hf,
      sheetName,
      sheetId,
      rowCount,
      colCount,
      formulaCells,
      fallbackValues
    );
  }

  private cellAddress(row: number, col: number) {
    return { sheet: this.sheetId, row, col };
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
      const val = this.hf.getCellValue(this.cellAddress(row, col));
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

  /** Přepočte celý list a vrátí zobrazení všech buněk. */
  refreshAllDisplays(): string[][] {
    try {
      this.hf.rebuildAndRecalculate();
    } catch (e) {
      console.warn("[CuttingPlanPreviewEngine] rebuildAndRecalculate", e);
    }
    return this.getAllDisplays();
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
    const content = toRawContent(value, false, this.sheetName);
    const addr = this.cellAddress(row, col);
    try {
      this.hf.setCellContents(addr, [[content]]);
    } catch (e) {
      console.warn("[CuttingPlanPreviewEngine] setCellContents failed", cellKey(row, col), e);
      try {
        this.hf.setCellContents(addr, [[value]]);
      } catch (e2) {
        console.warn("[CuttingPlanPreviewEngine] setCellContents text fallback", e2);
      }
    }
  }

  /** Změna vstupní buňky → přepočet všech vzorců → nové zobrazení. */
  applyInputChange(row: number, col: number, value: string): {
    displays: string[][];
    computedValues: Record<string, string>;
  } {
    this.setCellValue(row, col, value);
    const displays = this.refreshAllDisplays();
    return { displays, computedValues: this.getComputedValues() };
  }

  destroy(): void {
    try {
      this.hf.destroy();
    } catch {
      /* ignore */
    }
  }
}
