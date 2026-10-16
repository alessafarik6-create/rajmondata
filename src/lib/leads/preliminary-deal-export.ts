import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import {
  PRELIMINARY_DEAL_STATUS_LABELS,
  preliminaryDealPriceLabel,
  type PreliminaryDealDoc,
  type PreliminaryDealStatus,
} from "@/lib/leads/preliminary-deal-types";
import { computePreliminaryDealsSummary } from "@/lib/leads/preliminary-deal-summary";

export type PreliminaryDealExportRow = PreliminaryDealDoc & { id: string };

function formatDateCs(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("cs-CZ");
}

function formatCreatedAt(raw: unknown): string {
  if (!raw) return "—";
  if (typeof raw === "string") return formatDateCs(raw);
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate().toLocaleDateString("cs-CZ");
    } catch {
      return "—";
    }
  }
  return "—";
}

export function exportPreliminaryDealsToCsvBuffer(rows: PreliminaryDealExportRow[]): Buffer {
  const summary = computePreliminaryDealsSummary(rows);
  const header = [
    "Název",
    "Zákazník",
    "Telefon",
    "E-mail",
    "Předběžná cena (Kč)",
    "Režim DPH",
    "Termín realizace",
    "Stav",
    "Odpovědná osoba",
    "Datum vytvoření",
    "Poznámka",
  ];
  const lines: string[] = [];
  lines.push(`Souhrn;Počet;${summary.count}`);
  lines.push(`Souhrn;Pipeline (Kč);${summary.pipelineValue}`);
  lines.push(`Souhrn;Čeká na potvrzení (Kč);${summary.waitingConfirmationValue}`);
  lines.push(`Souhrn;Potvrzeno (Kč);${summary.confirmedValue}`);
  lines.push(`Souhrn;Převedeno (Kč);${summary.convertedValue}`);
  lines.push("");
  lines.push(header.join(";"));
  for (const r of rows) {
    lines.push(
      [
        r.title,
        r.customerName ?? "",
        r.customerPhone ?? "",
        r.customerEmail ?? "",
        String(Math.round(Number(r.priceAmount) || 0)),
        r.priceVatMode === "with_vat" ? "s DPH" : "bez DPH",
        formatDateCs(r.expectedCompletionDate ?? undefined),
        PRELIMINARY_DEAL_STATUS_LABELS[r.status as PreliminaryDealStatus] ?? r.status,
        r.responsibleEmployeeName ?? "",
        formatCreatedAt(r.createdAt),
        (r.note ?? "").replace(/\r?\n/g, " "),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(";")
    );
  }
  const body = `\uFEFF${lines.join("\r\n")}`;
  return Buffer.from(body, "utf8");
}

export function exportPreliminaryDealsToXlsxBuffer(rows: PreliminaryDealExportRow[]): Buffer {
  const summary = computePreliminaryDealsSummary(rows);
  const data = rows.map((r) => ({
    Název: r.title,
    Zákazník: r.customerName ?? "",
    Telefon: r.customerPhone ?? "",
    "E-mail": r.customerEmail ?? "",
    "Předběžná cena (Kč)": Math.round(Number(r.priceAmount) || 0),
    "Režim DPH": r.priceVatMode === "with_vat" ? "s DPH" : "bez DPH",
    "Termín realizace": formatDateCs(r.expectedCompletionDate ?? undefined),
    Stav: PRELIMINARY_DEAL_STATUS_LABELS[r.status as PreliminaryDealStatus] ?? r.status,
    "Odpovědná osoba": r.responsibleEmployeeName ?? "",
    "Datum vytvoření": formatCreatedAt(r.createdAt),
    Poznámka: r.note ?? "",
  }));
  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, wsData, "Předjednané zakázky");
  const wsSum = XLSX.utils.aoa_to_sheet([
    ["Metrika", "Hodnota"],
    ["Počet záznamů", summary.count],
    ["Pipeline (Kč)", summary.pipelineValue],
    ["Čeká na potvrzení (Kč)", summary.waitingConfirmationValue],
    ["Potvrzeno (Kč)", summary.confirmedValue],
    ["Převedeno do zakázek (Kč)", summary.convertedValue],
  ]);
  XLSX.utils.book_append_sheet(wb, wsSum, "Souhrn");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportSinglePreliminaryDealPdfBuffer(
  row: PreliminaryDealExportRow,
  orgName: string,
  logoUrl?: string | null
): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 16;
  if (logoUrl?.trim()) {
    try {
      doc.addImage(logoUrl.trim(), "PNG", 14, 10, 40, 14);
      y = 28;
    } catch {
      /* logo optional */
    }
  }
  doc.setFontSize(11);
  doc.text(orgName || "RAJMONDATA", 14, y);
  y += 8;
  doc.setFontSize(16);
  doc.text("Předjednaná zakázka", 14, y);
  y += 10;
  doc.setFontSize(10);
  doc.setTextColor(180, 0, 0);
  doc.text("PŘEDBĚŽNÝ ZÁZNAM – NEJEDNÁ SE O ZÁVAZNOU NABÍDKU ANI SMLOUVU.", 14, y, {
    maxWidth: 182,
  });
  doc.setTextColor(0, 0, 0);
  y += 12;

  const lines: [string, string][] = [
    ["Název", row.title],
    ["Zákazník", row.customerName ?? "—"],
    ["Popis práce", row.description || "—"],
    [
      "Předběžná cena",
      preliminaryDealPriceLabel(Number(row.priceAmount) || 0, row.priceVatMode),
    ],
    ["Termín realizace", formatDateCs(row.expectedCompletionDate ?? undefined)],
    [
      "Stav",
      PRELIMINARY_DEAL_STATUS_LABELS[row.status as PreliminaryDealStatus] ?? row.status,
    ],
    ["Datum vytvoření", formatCreatedAt(row.createdAt)],
    ["Poznámka", row.note ?? "—"],
  ];
  for (const [label, value] of lines) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, 14, y);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(String(value), 120);
    doc.text(wrapped, 52, y);
    y += Math.max(6, wrapped.length * 5);
    if (y > 270) break;
  }
  return Buffer.from(doc.output("arraybuffer"));
}

export function exportPreliminaryDealsListPdfBuffer(
  rows: PreliminaryDealExportRow[],
  orgName: string
): Buffer {
  const summary = computePreliminaryDealsSummary(rows);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(`Předjednané zakázky — ${orgName}`, 14, 14);
  doc.setFontSize(10);
  doc.text(
    `Počet: ${summary.count} · Pipeline: ${summary.pipelineValue.toLocaleString("cs-CZ")} Kč · Převedeno: ${summary.convertedValue.toLocaleString("cs-CZ")} Kč`,
    14,
    22
  );
  let y = 30;
  doc.setFontSize(8);
  for (const r of rows.slice(0, 80)) {
    const line = `${r.title} | ${r.customerName ?? "—"} | ${Math.round(Number(r.priceAmount) || 0)} Kč | ${PRELIMINARY_DEAL_STATUS_LABELS[r.status as PreliminaryDealStatus] ?? r.status}`;
    doc.text(doc.splitTextToSize(line, 270), 14, y);
    y += 5;
    if (y > 190) {
      doc.addPage();
      y = 14;
    }
  }
  return Buffer.from(doc.output("arraybuffer"));
}
