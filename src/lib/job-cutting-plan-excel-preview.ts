import * as XLSX from "xlsx";

export type CuttingPlanPreviewSheet = {
  name: string;
  rows: string[][];
};

export type CuttingPlanPreviewData = {
  sheets: CuttingPlanPreviewSheet[];
  truncated: boolean;
};

const MAX_PREVIEW_ROWS = 250;
const MAX_PREVIEW_COLS = 40;

function cellDisplayValue(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w != null && String(cell.w).length > 0) return String(cell.w);
  if (cell.v == null) return "";
  if (typeof cell.v === "boolean") return cell.v ? "Ano" : "Ne";
  if (cell.v instanceof Date) return cell.v.toLocaleString("cs-CZ");
  return String(cell.v);
}

function sheetToRows(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rowEnd = Math.min(range.e.r, range.s.r + MAX_PREVIEW_ROWS - 1);
  const colEnd = Math.min(range.e.c, range.s.c + MAX_PREVIEW_COLS - 1);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= rowEnd; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= colEnd; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      row.push(cellDisplayValue(sheet[addr]));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Náhled z uloženého souboru — zobrazí poslední uložené hodnoty (včetně výsledků vzorců z Excelu).
 * Vzorce v prohlížeči nepřepočítává; stažený soubor je nezměněný.
 */
export function parseCuttingPlanExcelBytes(
  bytes: ArrayBuffer,
  extension: "xlsx" | "xls" | "csv"
): CuttingPlanPreviewData {
  const readType = extension === "csv" ? "string" : "array";
  const data =
    extension === "csv"
      ? new TextDecoder("utf-8").decode(bytes)
      : bytes;
  const wb = XLSX.read(data, {
    type: readType,
    cellFormula: false,
    cellDates: true,
    raw: false,
  });
  const truncated =
    wb.SheetNames.some((name) => {
      const sheet = wb.Sheets[name];
      const ref = sheet?.["!ref"];
      if (!ref) return false;
      const range = XLSX.utils.decode_range(ref);
      return (
        range.e.r - range.s.r + 1 > MAX_PREVIEW_ROWS ||
        range.e.c - range.s.c + 1 > MAX_PREVIEW_COLS
      );
    }) || wb.SheetNames.length > 6;

  const sheets = wb.SheetNames.slice(0, 6).map((name) => ({
    name,
    rows: sheetToRows(wb.Sheets[name]),
  }));

  return { sheets, truncated };
}
