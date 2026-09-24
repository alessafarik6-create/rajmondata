export function escapeCsvCell(value: string | number | null | undefined): string {
  const s = String(value ?? "").replace(/"/g, '""');
  if (/[;\r\n"]/.test(s)) return `"${s}"`;
  return s;
}

export function downloadCsvFromRows(rows: string[][], fileName: string): void {
  const body = rows.map((r) => r.map(escapeCsvCell).join(";")).join("\r\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
