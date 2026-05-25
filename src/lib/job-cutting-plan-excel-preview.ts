import * as XLSX from "xlsx";

export const CUTTING_PLAN_PREVIEW_TIMEOUT_MS = 12_000;
export const CUTTING_PLAN_PREVIEW_MAX_ROWS = 100;
export const CUTTING_PLAN_PREVIEW_MAX_COLS = 30;
export const CUTTING_PLAN_PREVIEW_MAX_CELL_CHARS = 500;

export const CUTTING_PLAN_PREVIEW_LOAD_ERROR =
  "Náhled Excelu se nepodařilo načíst. Soubor si můžete stáhnout a otevřít v Excelu.";

export const CUTTING_PLAN_PREVIEW_EMPTY_MSG =
  "Excel neobsahuje žádná data pro náhled.";

export type CuttingPlanPreviewSheet = {
  name: string;
  rows: string[][];
};

export type CuttingPlanPreviewData = {
  sheets: CuttingPlanPreviewSheet[];
  truncated: boolean;
  empty: boolean;
};

/** Uložený náhled ve Firestore (rychlé zobrazení bez stahování souboru). */
export type CuttingPlanPreviewSnapshot = {
  sheetName: string;
  rows: string[][];
  truncated: boolean;
  empty: boolean;
  generatedAt: number;
};

function trimCell(value: unknown): string {
  if (value == null) return "";
  const s =
    value instanceof Date
      ? value.toLocaleString("cs-CZ")
      : typeof value === "boolean"
        ? value
          ? "Ano"
          : "Ne"
        : String(value);
  const t = s.trim();
  if (t.length <= CUTTING_PLAN_PREVIEW_MAX_CELL_CHARS) return t;
  return `${t.slice(0, CUTTING_PLAN_PREVIEW_MAX_CELL_CHARS)}…`;
}

function normalizeRows(aoa: unknown[][]): string[][] {
  const rows: string[][] = [];
  for (let r = 0; r < Math.min(aoa.length, CUTTING_PLAN_PREVIEW_MAX_ROWS); r++) {
    const src = aoa[r];
    if (!Array.isArray(src)) continue;
    const row: string[] = [];
    for (let c = 0; c < Math.min(src.length, CUTTING_PLAN_PREVIEW_MAX_COLS); c++) {
      row.push(trimCell(src[c]));
    }
    rows.push(row);
  }
  return rows;
}

function isEmptyRows(rows: string[][]): boolean {
  return rows.length === 0 || rows.every((row) => row.every((c) => !c));
}

function sheetWasTruncated(sheet: XLSX.WorkSheet | undefined): boolean {
  const ref = sheet?.["!ref"];
  if (!ref) return false;
  try {
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;
    return rowCount > CUTTING_PLAN_PREVIEW_MAX_ROWS || colCount > CUTTING_PLAN_PREVIEW_MAX_COLS;
  } catch {
    return false;
  }
}

function pickFirstSheetName(wb: XLSX.WorkBook): string | null {
  const names = wb.SheetNames ?? [];
  if (names.length === 0) return null;
  const tagged = names.find((n) => /nářez|narez|plánek|planek|preview|náhled/i.test(n));
  return tagged ?? names[0];
}

/**
 * Parsuje pouze první (nebo označený) list — zobrazí uložené hodnoty, ne přepočítává vzorce.
 */
export function parseCuttingPlanExcelBytes(
  bytes: ArrayBuffer,
  extension: "xlsx" | "xls" | "csv"
): CuttingPlanPreviewData {
  const readType = extension === "csv" ? "string" : "array";
  const data =
    extension === "csv" ? new TextDecoder("utf-8").decode(bytes) : bytes;

  const wb = XLSX.read(data, {
    type: readType,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    bookDeps: false,
    sheetRows: CUTTING_PLAN_PREVIEW_MAX_ROWS + 5,
    cellDates: true,
    raw: false,
  });

  const sheetName = pickFirstSheetName(wb);
  if (!sheetName) {
    return { sheets: [], truncated: false, empty: true };
  }

  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return { sheets: [], truncated: false, empty: true };
  }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  }) as unknown[][];

  const rows = normalizeRows(aoa);
  const empty = isEmptyRows(rows);
  const truncated = sheetWasTruncated(sheet);

  return {
    sheets: empty ? [] : [{ name: sheetName, rows }],
    truncated,
    empty,
  };
}

export async function parseCuttingPlanExcelFile(file: File): Promise<CuttingPlanPreviewData> {
  const extension =
    file.name.toLowerCase().endsWith(".csv")
      ? "csv"
      : file.name.toLowerCase().endsWith(".xls")
        ? "xls"
        : "xlsx";
  const bytes = await file.arrayBuffer();
  return parseCuttingPlanExcelBytes(bytes, extension as "xlsx" | "xls" | "csv");
}

export function previewDataToSnapshot(data: CuttingPlanPreviewData): CuttingPlanPreviewSnapshot | null {
  const sheet = data.sheets[0];
  if (!sheet || data.empty) {
    return {
      sheetName: sheet?.name ?? "List1",
      rows: [],
      truncated: data.truncated,
      empty: true,
      generatedAt: Date.now(),
    };
  }
  return {
    sheetName: sheet.name,
    rows: sheet.rows,
    truncated: data.truncated,
    empty: false,
    generatedAt: Date.now(),
  };
}

export function snapshotToPreviewData(
  snap: CuttingPlanPreviewSnapshot | null | undefined
): CuttingPlanPreviewData | null {
  if (!snap || typeof snap !== "object") return null;
  const rows = Array.isArray(snap.rows)
    ? snap.rows
        .filter((r) => Array.isArray(r))
        .map((r) => r.map((c) => trimCell(c)))
    : [];
  const empty = snap.empty === true || isEmptyRows(rows);
  if (empty) {
    return { sheets: [], truncated: !!snap.truncated, empty: true };
  }
  const name = String(snap.sheetName ?? "List1").trim() || "List1";
  return {
    sheets: [{ name, rows }],
    truncated: !!snap.truncated,
    empty: false,
  };
}

export function parsePreviewSnapshotFromFirestore(
  raw: unknown
): CuttingPlanPreviewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rows = Array.isArray(o.rows)
    ? (o.rows as unknown[][]).map((r) =>
        Array.isArray(r) ? r.map((c) => trimCell(c)) : []
      )
    : [];
  const generatedAt =
    typeof o.generatedAt === "number" && Number.isFinite(o.generatedAt)
      ? o.generatedAt
      : 0;
  return {
    sheetName: String(o.sheetName ?? "List1").trim() || "List1",
    rows,
    truncated: o.truncated === true,
    empty: o.empty === true || isEmptyRows(rows),
    generatedAt,
  };
}
