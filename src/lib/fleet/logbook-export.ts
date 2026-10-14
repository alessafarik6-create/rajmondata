import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import type { FleetTripDoc } from "@/lib/fleet/types";

export type LogbookExportRow = {
  orgName: string;
  vehicleId: string;
  licensePlate: string;
  started: Date | null;
  ended: Date | null;
  startAddress: string;
  endAddress: string;
  km: number;
  tripTypeCs: string;
  purpose: string;
  driverName: string;
  job: string;
  note: string;
};

export function buildLogbookRows(
  trips: (FleetTripDoc & { id: string })[],
  plateById: Map<string, string>,
  orgName: string
): { rows: LogbookExportRow[]; totalKm: number } {
  let totalKm = 0;
  const rows = trips.map((t) => {
    const started = t.startedAt?.toDate?.() ?? null;
    const ended = t.endedAt?.toDate?.() ?? null;
    const km = Number(t.distanceKm ?? 0);
    totalKm += km;
    return {
      orgName,
      vehicleId: t.vehicleId,
      licensePlate: plateById.get(t.vehicleId) ?? "",
      started,
      ended,
      startAddress: t.startAddress ?? "",
      endAddress: t.endAddress ?? "",
      km,
      tripTypeCs: t.tripType === "private" ? "Soukromá" : "Služební",
      purpose: t.purpose ?? "",
      driverName: t.driverName ?? "",
      job: t.jobLabel ?? t.jobId ?? "",
      note: t.note ?? "",
    };
  });
  return { rows, totalKm };
}

export function logbookToXlsxBuffer(rows: LogbookExportRow[], totalKm: number): Buffer {
  const header = [
    "Organizace",
    "Vozidlo ID",
    "SPZ",
    "Datum",
    "Odjezd",
    "Příjezd",
    "Odkud",
    "Kam",
    "Km",
    "Typ jízdy",
    "Účel",
    "Řidič",
    "Zakázka",
    "Poznámka",
  ];
  const data = rows.map((r) => [
    r.orgName,
    r.vehicleId,
    r.licensePlate,
    r.started ? r.started.toLocaleDateString("cs-CZ") : "",
    r.started ? r.started.toLocaleTimeString("cs-CZ") : "",
    r.ended ? r.ended.toLocaleTimeString("cs-CZ") : "",
    r.startAddress,
    r.endAddress,
    r.km ? r.km : "",
    r.tripTypeCs,
    r.purpose,
    r.driverName,
    r.job,
    r.note,
  ]);
  data.push(["", "", "", "", "", "", "", "Souhrn km", totalKm, "", "", "", "", ""]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Kniha jízd");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function logbookToPdfBuffer(rows: LogbookExportRow[], totalKm: number, orgName: string): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  registerDejaVuFontsForPdf(doc);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(14);
  doc.text(`Kniha jízd — ${orgName}`, 14, 16);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.text(`Vygenerováno: ${new Date().toLocaleString("cs-CZ")}`, 14, 22);

  autoTable(doc, {
    startY: 26,
    head: [
      [
        "SPZ",
        "Datum",
        "Odjezd",
        "Příjezd",
        "Odkud",
        "Kam",
        "Km",
        "Typ",
        "Řidič",
        "Zakázka",
      ],
    ],
    body: rows.map((r) => [
      r.licensePlate,
      r.started ? r.started.toLocaleDateString("cs-CZ") : "",
      r.started ? r.started.toLocaleTimeString("cs-CZ") : "",
      r.ended ? r.ended.toLocaleTimeString("cs-CZ") : "",
      r.startAddress.slice(0, 40),
      r.endAddress.slice(0, 40),
      r.km ? String(r.km).replace(".", ",") : "",
      r.tripTypeCs,
      r.driverName,
      r.job.slice(0, 30),
    ]),
    styles: { font: PDF_FONT_FAMILY, fontSize: 8 },
    headStyles: { font: PDF_FONT_FAMILY, fillColor: [234, 88, 12] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
  doc.text(`Souhrn ujetých km: ${String(totalKm).replace(".", ",")}`, 14, finalY + 8);

  return Buffer.from(doc.output("arraybuffer"));
}
