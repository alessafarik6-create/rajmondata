/** Firestore-safe serializace náhledu — bez vnořených polí (arrays in arrays). */

import { CUTTING_PLAN_PREVIEW_MAX_COLS } from "@/lib/job-cutting-plan-excel-constants";

export type PreviewRowFirestore = Record<string, string>;

export function colKey(col: number): string {
  return `c${col}`;
}

export function cellKey(row: number, col: number): string {
  return `r${row}c${col}`;
}

export function rows2dToFirestore(rows: string[][]): PreviewRowFirestore[] {
  return rows.map((row) => {
    const out: PreviewRowFirestore = {};
    for (let c = 0; c < Math.min(row.length, CUTTING_PLAN_PREVIEW_MAX_COLS); c++) {
      const v = String(row[c] ?? "").trim();
      if (v) out[colKey(c)] = String(row[c] ?? "");
    }
    return out;
  });
}

export function firestoreToRows2d(
  previewRows: PreviewRowFirestore[] | null | undefined,
  columnCount: number
): string[][] {
  const cols = Math.min(Math.max(columnCount, 1), CUTTING_PLAN_PREVIEW_MAX_COLS);
  const list = Array.isArray(previewRows) ? previewRows : [];
  return list.map((rowObj) => {
    if (!rowObj || typeof rowObj !== "object") return Array(cols).fill("");
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const v = rowObj[colKey(c)];
      row.push(v != null ? String(v) : "");
    }
    return row;
  });
}

export function parseStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && v != null) out[k] = String(v);
  }
  return out;
}

export function previewRowsFromLegacy(raw: unknown): PreviewRowFirestore[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PreviewRowFirestore[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      const row: PreviewRowFirestore = {};
      item.forEach((v, i) => {
        if (v != null && String(v).trim() !== "") row[colKey(i)] = String(v);
      });
      out.push(row);
    } else if (item && typeof item === "object") {
      out.push(item as PreviewRowFirestore);
    }
  }
  return out.length ? out : null;
}
