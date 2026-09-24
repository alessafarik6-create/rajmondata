import { downloadCsvFromRows } from "@/lib/csv-download";
import { printInvoiceHtmlDocument } from "@/lib/print-html";

export type DocumentExportRow = {
  id: string;
  kind: "invoice" | "document";
  number: string;
  customer: string;
  date: string;
  amount: string;
  status: string;
  pdfHtml?: string;
};

export function exportDocumentRowsCsv(rows: DocumentExportRow[], fileName: string): void {
  const head = ["Typ", "Číslo", "Zákazník", "Datum", "Částka", "Stav"];
  const body = rows.map((r) => [
    r.kind === "invoice" ? "Faktura" : "Doklad",
    r.number,
    r.customer,
    r.date,
    r.amount,
    r.status,
  ]);
  downloadCsvFromRows([head, ...body], fileName);
}

/** Postupný tisk vybraných dokladů (PDF HTML). */
export async function printSelectedDocumentRows(rows: DocumentExportRow[]): Promise<number> {
  let printed = 0;
  for (const row of rows) {
    const html = String(row.pdfHtml ?? "").trim();
    if (!html) continue;
    const res = printInvoiceHtmlDocument(html, row.number);
    if (res === "ok") printed += 1;
    await new Promise((r) => setTimeout(r, 400));
  }
  return printed;
}
