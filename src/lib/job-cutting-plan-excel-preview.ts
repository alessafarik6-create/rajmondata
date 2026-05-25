import * as XLSX from "xlsx";
import {
  CUTTING_PLAN_PREVIEW_MAX_CELL_CHARS,
  CUTTING_PLAN_PREVIEW_MAX_COLS,
  CUTTING_PLAN_PREVIEW_MAX_ROWS,
} from "@/lib/job-cutting-plan-excel-constants";
import {
  cellKey,
  firestoreToRows2d,
  parseStringMap,
  previewRowsFromLegacy,
  rows2dToFirestore,
  type PreviewRowFirestore,
} from "@/lib/job-cutting-plan-excel-storage";

export {
  CUTTING_PLAN_PREVIEW_TIMEOUT_MS,
  CUTTING_PLAN_PREVIEW_MAX_ROWS,
  CUTTING_PLAN_PREVIEW_MAX_COLS,
  CUTTING_PLAN_PREVIEW_MAX_HEIGHT_PX,
  CUTTING_PLAN_PREVIEW_LOAD_ERROR,
  CUTTING_PLAN_PREVIEW_EMPTY_MSG,
} from "@/lib/job-cutting-plan-excel-constants";

export type CuttingPlanPreviewSheet = {
  name: string;
  rows: string[][];
};

export type CuttingPlanPreviewData = {
  sheets: CuttingPlanPreviewSheet[];
  truncated: boolean;
  empty: boolean;
  formulaCells: Record<string, string>;
  cellOverrides: Record<string, string>;
  columnCount: number;
};

/** Náhled uložený u zakázky (v paměti 2D pole, ve Firestore flat objekty). */
export type CuttingPlanPreviewSnapshot = {
  sheetName: string;
  rows: string[][];
  columnCount: number;
  formulaCells: Record<string, string>;
  cellOverrides: Record<string, string>;
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

function extractSheetGrid(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range
): { rows: string[][]; formulaCells: Record<string, string>; columnCount: number } {
  const rowEnd = Math.min(range.e.r, range.s.r + CUTTING_PLAN_PREVIEW_MAX_ROWS - 1);
  const colEnd = Math.min(range.e.c, range.s.c + CUTTING_PLAN_PREVIEW_MAX_COLS - 1);
  const colCount = colEnd - range.s.c + 1;
  const rows: string[][] = [];
  const formulaCells: Record<string, string> = {};

  for (let r = range.s.r; r <= rowEnd; r++) {
    const row: string[] = [];
    const gridR = r - range.s.r;
    for (let c = range.s.c; c <= colEnd; c++) {
      const gridC = c - range.s.c;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      if (cell?.f) {
        const f = String(cell.f).trim();
        if (f) formulaCells[cellKey(gridR, gridC)] = f.startsWith("=") ? f : `=${f}`;
      }
      row.push(trimCell(cell?.w ?? cell?.v));
    }
    rows.push(row);
  }

  return { rows, formulaCells, columnCount: colCount };
}

export function parseCuttingPlanExcelBytes(
  bytes: ArrayBuffer,
  extension: "xlsx" | "xls" | "csv"
): CuttingPlanPreviewData {
  const readType = extension === "csv" ? "string" : "array";
  const data =
    extension === "csv" ? new TextDecoder("utf-8").decode(bytes) : bytes;

  const wb = XLSX.read(data, {
    type: readType,
    cellFormula: true,
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
    return {
      sheets: [],
      truncated: false,
      empty: true,
      formulaCells: {},
      cellOverrides: {},
      columnCount: 0,
    };
  }

  const sheet = wb.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    return {
      sheets: [],
      truncated: false,
      empty: true,
      formulaCells: {},
      cellOverrides: {},
      columnCount: 0,
    };
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const { rows, formulaCells, columnCount } = extractSheetGrid(sheet, range);
  const empty = isEmptyRows(rows);
  const truncated = sheetWasTruncated(sheet);

  return {
    sheets: empty ? [] : [{ name: sheetName, rows }],
    truncated,
    empty,
    formulaCells,
    cellOverrides: {},
    columnCount,
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
  const generatedAt = Date.now();
  if (!sheet || data.empty) {
    return {
      sheetName: sheet?.name ?? "List1",
      rows: [],
      columnCount: data.columnCount || 0,
      formulaCells: data.formulaCells ?? {},
      cellOverrides: data.cellOverrides ?? {},
      truncated: data.truncated,
      empty: true,
      generatedAt,
    };
  }
  return {
    sheetName: sheet.name,
    rows: sheet.rows,
    columnCount: data.columnCount || sheet.rows[0]?.length || 0,
    formulaCells: data.formulaCells ?? {},
    cellOverrides: data.cellOverrides ?? {},
    truncated: data.truncated,
    empty: false,
    generatedAt,
  };
}

export function snapshotToPreviewData(
  snap: CuttingPlanPreviewSnapshot | null | undefined
): CuttingPlanPreviewData | null {
  if (!snap || typeof snap !== "object") return null;
  const rows = snap.rows.map((r) => r.map((c) => trimCell(c)));
  const empty = snap.empty === true || isEmptyRows(rows);
  if (empty) {
    return {
      sheets: [],
      truncated: !!snap.truncated,
      empty: true,
      formulaCells: snap.formulaCells ?? {},
      cellOverrides: snap.cellOverrides ?? {},
      columnCount: snap.columnCount,
    };
  }
  const name = String(snap.sheetName ?? "List1").trim() || "List1";
  return {
    sheets: [{ name, rows }],
    truncated: !!snap.truncated,
    empty: false,
    formulaCells: snap.formulaCells ?? {},
    cellOverrides: snap.cellOverrides ?? {},
    columnCount: snap.columnCount,
  };
}

/** Pole pro zápis do Firestore (bez nested arrays). */
export function snapshotToFirestoreFields(
  snap: CuttingPlanPreviewSnapshot | null
): Record<string, unknown> {
  if (!snap) {
    return {
      previewRows: [],
      previewColumns: 0,
      formulaCells: {},
      cellOverrides: {},
      previewTruncated: false,
      previewEmpty: true,
      previewGeneratedAt: null,
      preview: null,
    };
  }
  return {
    sheetName: snap.sheetName,
    previewColumns: snap.columnCount,
    previewRows: rows2dToFirestore(snap.rows),
    formulaCells: snap.formulaCells ?? {},
    cellOverrides: snap.cellOverrides ?? {},
    previewTruncated: snap.truncated,
    previewEmpty: snap.empty,
    previewGeneratedAt: snap.generatedAt,
    preview: null,
  };
}

export function parsePreviewFromJobDoc(
  raw: Record<string, unknown> | null | undefined
): CuttingPlanPreviewSnapshot | null {
  if (!raw) return null;

  let previewRows: PreviewRowFirestore[] | null = null;
  if (Array.isArray(raw.previewRows)) {
    previewRows = raw.previewRows as PreviewRowFirestore[];
  } else if (raw.preview && typeof raw.preview === "object") {
    const legacy = raw.preview as Record<string, unknown>;
    previewRows = previewRowsFromLegacy(legacy.rows);
    if (!previewRows && Array.isArray(legacy.previewRows)) {
      previewRows = legacy.previewRows as PreviewRowFirestore[];
    }
  }

  const columnCount =
    typeof raw.previewColumns === "number"
      ? raw.previewColumns
      : typeof (raw.preview as Record<string, unknown> | undefined)?.previewColumns ===
          "number"
        ? Number((raw.preview as Record<string, unknown>).previewColumns)
        : CUTTING_PLAN_PREVIEW_MAX_COLS;

  const rows = firestoreToRows2d(previewRows, columnCount);
  const formulaCells = parseStringMap(
    raw.formulaCells ??
      (raw.preview as Record<string, unknown> | undefined)?.formulaCells
  );
  const cellOverrides = parseStringMap(
    raw.cellOverrides ??
      (raw.preview as Record<string, unknown> | undefined)?.cellOverrides
  );

  const generatedAt =
    typeof raw.previewGeneratedAt === "number"
      ? raw.previewGeneratedAt
      : typeof (raw.preview as Record<string, unknown> | undefined)?.generatedAt === "number"
        ? Number((raw.preview as Record<string, unknown>).generatedAt)
        : 0;

  const sheetName =
    String(raw.sheetName ?? "").trim() ||
    String((raw.preview as Record<string, unknown> | undefined)?.sheetName ?? "").trim() ||
    "List1";

  const truncated =
    raw.previewTruncated === true ||
    (raw.preview as Record<string, unknown> | undefined)?.truncated === true;
  const empty =
    raw.previewEmpty === true ||
    (raw.preview as Record<string, unknown> | undefined)?.empty === true ||
    isEmptyRows(rows);

  if (!previewRows?.length && !generatedAt && raw.previewEmpty !== true) {
    return null;
  }

  return {
    sheetName,
    rows,
    columnCount,
    formulaCells,
    cellOverrides,
    truncated,
    empty,
    generatedAt,
  };
}

/** @deprecated použij parsePreviewFromJobDoc */
export function parsePreviewSnapshotFromFirestore(
  raw: unknown
): CuttingPlanPreviewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray((raw as Record<string, unknown>).rows)) {
    return parsePreviewFromJobDoc({ preview: raw } as Record<string, unknown>);
  }
  return parsePreviewFromJobDoc(raw as Record<string, unknown>);
}
