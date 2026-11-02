import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadCsvFromRows } from "@/lib/csv-download";
import type {
  WorkStatementAnomaly,
  WorkStatementHoursBySource,
  WorkStatementIntervalRow,
  WorkStatementSummary,
} from "@/lib/labor/employee-work-statement";

export function exportWorkStatementCsv(
  rows: WorkStatementIntervalRow[],
  fileName: string,
  includeMoney: boolean
): void {
  const head = [
    "Datum",
    "Zakázka",
    "Číslo",
    "Operace",
    "Od",
    "Do",
    "Odpracováno",
    "Zdroj",
    ...(includeMoney ? ["Tarif Kč/h", "Částka Kč"] : []),
  ];
  const body = rows.map((r) => [
    r.workDateIso,
    r.jobName,
    r.jobNumber,
    r.operationName,
    r.startedAtIso,
    r.endedAtIso ?? "",
    r.durationLabel,
    r.source.toUpperCase(),
    ...(includeMoney
      ? [String(r.hourlyRateCzk ?? ""), String(r.amountCzk ?? "")]
      : []),
  ]);
  downloadCsvFromRows([head, ...body], fileName);
}

export function exportWorkStatementXlsx(params: {
  employeeName: string;
  organizationName: string;
  fromIso: string;
  toIso: string;
  rows: WorkStatementIntervalRow[];
  hoursBySource: WorkStatementHoursBySource;
  summary: WorkStatementSummary;
  anomalies: WorkStatementAnomaly[];
  includeMoney: boolean;
  exportedBy: string;
  fileName: string;
}): void {
  const wb = XLSX.utils.book_new();
  const summaryAoA = [
    ["RAJMONDATA – pracovní výkaz"],
    ["Organizace", params.organizationName],
    ["Zaměstnanec", params.employeeName],
    ["Období", `${params.fromIso} – ${params.toIso}`],
    ["Export", new Date().toLocaleString("cs-CZ")],
    ["Exportoval", params.exportedBy],
    [],
    ["Souhrn"],
    ["Celkem QR hodin", params.summary.totalQrHours],
    ["Pracovní dny", params.summary.distinctWorkDays],
    ["Zakázky", params.summary.distinctJobs],
    ["Operace", params.summary.distinctOperations],
    [],
    ["Odpracované hodiny podle zdroje"],
    ["Uznáno pro mzdu (docházka/výkaz)", params.hoursBySource.recognizedPayableHours],
    ["Docházka netto", params.hoursBySource.attendanceNetHours],
    ["Terminál (úseky)", params.hoursBySource.terminalSegmentHours],
    ["QR na zakázkách", params.hoursBySource.qrJobHours],
    ["Nepřiřazeno k zakázce", params.hoursBySource.unassignedToJobHours],
    ["Čeká na schválení", params.hoursBySource.pendingApprovalHours],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoA), "Souhrn");

  const qrHead = [
    "Datum",
    "Zakázka",
    "Číslo",
    "Operace",
    "Od",
    "Do",
    "Minut",
    "Zdroj",
    ...(params.includeMoney ? ["Tarif", "Částka"] : []),
  ];
  const qrBody = params.rows.map((r) => [
    r.workDateIso,
    r.jobName,
    r.jobNumber,
    r.operationName,
    r.startedAtIso,
    r.endedAtIso ?? "",
    r.durationMinutes,
    r.source,
    ...(params.includeMoney ? [r.hourlyRateCzk ?? "", r.amountCzk ?? ""] : []),
  ]);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([qrHead, ...qrBody]),
    "QR zakázky"
  );

  const anHead = ["Závažnost", "Kód", "Zpráva", "Den"];
  const anBody = params.anomalies.map((a) => [
    a.severity,
    a.code,
    a.message,
    a.workDateIso ?? "",
  ]);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([anHead, ...anBody]),
    "Nesrovnalosti"
  );

  XLSX.writeFile(wb, `${params.fileName}.xlsx`);
}

export function exportWorkStatementPdf(params: {
  employeeName: string;
  organizationName: string;
  fromIso: string;
  toIso: string;
  rows: WorkStatementIntervalRow[];
  hoursBySource: WorkStatementHoursBySource;
  includeMoney: boolean;
  exportedBy: string;
  fileName: string;
}): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text("RAJMONDATA – PRACOVNÍ VÝKAZ ZAMĚSTNANCE", 14, 16);
  doc.setFontSize(10);
  doc.text(params.organizationName, 14, 24);
  doc.text(params.employeeName, 14, 30);
  doc.text(`Období: ${params.fromIso} – ${params.toIso}`, 14, 36);
  doc.text(`Vygenerováno: ${new Date().toLocaleString("cs-CZ")} · ${params.exportedBy}`, 14, 42);
  doc.text(
    `Uznáno pro mzdu: ${params.hoursBySource.recognizedPayableHours} h · QR na zakázkách: ${params.hoursBySource.qrJobHours} h · Nepřiřazeno: ${params.hoursBySource.unassignedToJobHours} h`,
    14,
    48
  );

  const head = [
    "Datum",
    "Zakázka",
    "Operace",
    "Od",
    "Do",
    "Trvání",
    "Zdroj",
    ...(params.includeMoney ? ["Kč"] : []),
  ];
  const body = params.rows.map((r) => [
    r.workDateIso,
    r.jobNumber ? `${r.jobNumber} ${r.jobName}` : r.jobName,
    r.operationName,
    new Date(r.startedAtIso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }),
    r.endedAtIso
      ? new Date(r.endedAtIso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
      : "—",
    r.durationLabel,
    r.source.toUpperCase(),
    ...(params.includeMoney ? [String(r.amountCzk ?? "")] : []),
  ]);

  autoTable(doc, {
    startY: 54,
    head: [head],
    body,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [234, 88, 12] },
  });

  doc.save(`${params.fileName}.pdf`);
}
