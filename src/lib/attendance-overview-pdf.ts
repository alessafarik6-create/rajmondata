/**
 * PDF export přehledu docházky — stejná data jako tisková šablona na stránce.
 */

import { jsPDF } from "jspdf";
import type {
  DailyDetailPeriodTotals,
  EmployeeDailyDetailRow,
  OverviewTableRow,
} from "@/lib/attendance-overview-compute";
import { formatHoursMinutes, formatKc } from "@/lib/attendance-overview-compute";

const MARGIN_MM = 14;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN_MM * 2;
const PAGE_BOTTOM = 287;
const LINE_H = 4.2;

function formatHoursLocal(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  return `${h} h`;
}

function formatHoursPeriodTotal(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0 h";
  return formatHoursMinutes(h);
}

function formatRateKcPerH(kc: number | null): string {
  const n = Number(kc);
  if (kc == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} Kč/h`;
}

function addLines(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): number {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + Math.max(lines.length, 1) * LINE_H;
}

function newPageY(doc: jsPDF, y: number, minSpace: number): number {
  if (y + minSpace > PAGE_BOTTOM) {
    doc.addPage();
    return MARGIN_MM + 6;
  }
  return y;
}

export type AttendanceOverviewPdfParams = {
  companyName: string;
  companyId: string | undefined;
  rangeLabel: string;
  rangeStr: { start: string; end: string };
  periodTitle: string;
  customRangeLine: string | null;
  employeeLabel: string;
  generatedAtLabel: string;
  variant: "detail" | "summary";
  dailyDetailRows: EmployeeDailyDetailRow[] | null;
  detailTotals: DailyDetailPeriodTotals | null;
  summaryTotalsAll: DailyDetailPeriodTotals | null;
  tableRows: OverviewTableRow[];
  aggregateTotals: { hours: number; approvedKc: number; pendingKc: number };
  hasEmptyData: boolean;
};

export function buildAttendanceOverviewPdf(params: AttendanceOverviewPdfParams): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN_MM + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  y = addLines(doc, "Přehled docházky a výdělků", MARGIN_MM, y, CONTENT_W);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);

  const org = params.companyName || params.companyId || "—";
  y = addLines(doc, `Organizace: ${org}`, MARGIN_MM, y, CONTENT_W);
  y = addLines(doc, `Období: ${params.rangeLabel}`, MARGIN_MM, y, CONTENT_W);
  y = addLines(doc, `Režim: ${params.periodTitle}`, MARGIN_MM, y, CONTENT_W);
  if (params.customRangeLine) {
    y = addLines(doc, params.customRangeLine, MARGIN_MM, y, CONTENT_W);
  }
  y = addLines(doc, `Vygenerováno: ${params.generatedAtLabel}`, MARGIN_MM, y, CONTENT_W);
  y = addLines(doc, `Zaměstnanec / výběr: ${params.employeeLabel}`, MARGIN_MM, y, CONTENT_W);
  y += 4;

  if (params.hasEmptyData) {
    doc.setFont("helvetica", "italic");
    y = addLines(doc, "Žádná data pro zvolené filtry.", MARGIN_MM, y, CONTENT_W);
    return doc;
  }

  if (params.variant === "detail" && params.dailyDetailRows && params.detailTotals) {
    const dt = params.detailTotals;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    y = newPageY(doc, y, 24);
    y = addLines(
      doc,
      `Souhrn období: dny s prací ${dt.daysWorked} | odpracováno ${formatHoursLocal(dt.hours)} | schváleno ${formatKc(dt.approvedKc)} | orientačně ${formatKc(dt.orientacniKc)}`,
      MARGIN_MM,
      y,
      CONTENT_W
    );
    y = addLines(
      doc,
      `Tarify: ${formatHoursPeriodTotal(dt.totalTariffHours)} / ${formatKc(dt.totalTariffKc)} | mimo tarif (docházka − tarify): ${formatHoursPeriodTotal(dt.totalHoursOutsideTariffOnly)} | zakázky: ${formatHoursPeriodTotal(dt.totalJobHours)} / ${formatKc(dt.totalJobKc)} | mimo tarif i zakázku: ${formatHoursPeriodTotal(dt.totalHoursOutsideTariffJob)} / ${formatKc(dt.totalStandardKc)}`,
      MARGIN_MM,
      y,
      CONTENT_W
    );
    y += 6;
    doc.setFont("helvetica", "normal");

    for (const day of params.dailyDetailRows) {
      y = newPageY(doc, y, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      y = addLines(doc, day.dayTitle, MARGIN_MM, y, CONTENT_W);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      y = addLines(
        doc,
        `Příchod: ${day.prichod}   Odchod: ${day.odchod}   Odpracováno: ${formatHoursLocal(day.odpracovanoH)}   Záznamů docházky: ${day.bloku}`,
        MARGIN_MM,
        y,
        CONTENT_W
      );
      y = addLines(
        doc,
        `Čas na tarifech (součet): ${formatHoursMinutes(day.tariffHoursTotal)}   Čas mimo tarif (docházka − tarify): ${formatHoursMinutes(day.hoursOutsideTariffOnly)}`,
        MARGIN_MM,
        y,
        CONTENT_W
      );

      for (const t of day.tariffSegments) {
        y = newPageY(doc, y, 10);
        y = addLines(
          doc,
          `  ${t.label}: ${t.startHm}–${t.endLabel}, ${formatHoursMinutes(t.durationH)}, ${formatRateKcPerH(t.rateKcPerH)}, ${formatKc(t.earningsKc)}`,
          MARGIN_MM,
          y,
          CONTENT_W
        );
      }
      for (const j of day.jobSegments) {
        y = newPageY(doc, y, 10);
        y = addLines(
          doc,
          `  ${j.label}: ${j.startHm}–${j.endLabel}, ${formatHoursMinutes(j.durationH)}, ${formatRateKcPerH(j.rateKcPerH)}, ${formatKc(j.earningsKc)}`,
          MARGIN_MM,
          y,
          CONTENT_W
        );
      }
      y = newPageY(doc, y, 12);
      y = addLines(
        doc,
        `Orientační rozpad: mimo tarif i zakázku (standard) ${formatHoursLocal(day.hoursOutsideTariffAndJob)} ${formatKc(day.orientacniKcStandard)} | z tarifů ${formatKc(day.orientacniKcTariff)} | ze zakázek ${formatKc(day.orientacniKcJob)} | celkem orientačně ${formatKc(day.orientacniKc)}`,
        MARGIN_MM,
        y,
        CONTENT_W
      );
      const schLabel =
        day.schvalenoStatus === "pending"
          ? " (čeká na schválení)"
          : day.schvalenoStatus === "none" && (day.odpracovanoH ?? 0) > 0
            ? " (neodsouhlaseno)"
            : "";
      y = addLines(
        doc,
        `Schválený výdělek: ${formatKc(day.schvalenoKc)}${schLabel}`,
        MARGIN_MM,
        y,
        CONTENT_W
      );
      y += 4;
    }

    y = newPageY(doc, y, 36);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    y = addLines(doc, "Souhrn dokumentu", MARGIN_MM, y, CONTENT_W);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = addLines(doc, `Celkem odpracováno (docházka): ${formatHoursLocal(dt.hours)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkem čas na tarifech: ${formatHoursPeriodTotal(dt.totalTariffHours)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkem čas mimo tarif (docházka − tarify): ${formatHoursPeriodTotal(dt.totalHoursOutsideTariffOnly)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkový orientační výdělek: ${formatKc(dt.orientacniKc)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkový schválený výdělek: ${formatKc(dt.approvedKc)}`, MARGIN_MM, y, CONTENT_W);
    return doc;
  }

  const agg = params.summaryTotalsAll;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  y = newPageY(doc, y, 30);
  if (agg) {
    y = addLines(
      doc,
      `Souhrn za všechny zaměstnance: odpracováno ${formatHoursLocal(agg.hours)} | schváleno ${formatKc(agg.approvedKc)} | orientačně ${formatKc(agg.orientacniKc)}`,
      MARGIN_MM,
      y,
      CONTENT_W
    );
    y = addLines(
      doc,
      `Tarify: ${formatHoursPeriodTotal(agg.totalTariffHours)} / ${formatKc(agg.totalTariffKc)} | mimo tarif (docházka − tarify): ${formatHoursPeriodTotal(agg.totalHoursOutsideTariffOnly)} | zakázky: ${formatHoursPeriodTotal(agg.totalJobHours)} / ${formatKc(agg.totalJobKc)}`,
      MARGIN_MM,
      y,
      CONTENT_W
    );
  } else {
    y = addLines(
      doc,
      `Celkem odpracováno: ${formatHoursLocal(params.aggregateTotals.hours)} | schváleno ${formatKc(params.aggregateTotals.approvedKc)} | orientačně ${formatKc(params.aggregateTotals.pendingKc)}`,
      MARGIN_MM,
      y,
      CONTENT_W
    );
  }
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const colW = [42, 34, 18, 18, 22, 16, 26, 26];
  const headers = [
    "Období / datum",
    "Jméno",
    "Příchod",
    "Odchod",
    "Hodiny",
    "Záznamů",
    "Schváleno",
    "Orientačně",
  ];
  let x = MARGIN_MM;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y);
    x += colW[i];
  }
  y += LINE_H;
  doc.setFont("helvetica", "normal");
  for (const row of params.tableRows) {
    y = newPageY(doc, y, 8);
    const line = [
      row.datumLabel.slice(0, 22),
      row.employeeName.slice(0, 18),
      row.prichod,
      row.odchod,
      formatHoursLocal(row.odpracovanoH),
      String(row.bloku),
      formatKc(row.schvalenoKc),
      formatKc(row.orientacniKc),
    ];
    x = MARGIN_MM;
    for (let i = 0; i < line.length; i++) {
      doc.text(String(line[i]), x, y);
      x += colW[i];
    }
    y += LINE_H;
  }

  y = newPageY(doc, y, 36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  y = addLines(doc, "Souhrn dokumentu", MARGIN_MM, y, CONTENT_W);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (agg) {
    y = addLines(doc, `Celkem odpracováno: ${formatHoursLocal(agg.hours)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkem čas na tarifech: ${formatHoursPeriodTotal(agg.totalTariffHours)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkem čas mimo tarif (docházka − tarify): ${formatHoursPeriodTotal(agg.totalHoursOutsideTariffOnly)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkový orientační výdělek: ${formatKc(agg.orientacniKc)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkový schválený výdělek: ${formatKc(agg.approvedKc)}`, MARGIN_MM, y, CONTENT_W);
  } else {
    y = addLines(doc, `Celkem odpracováno: ${formatHoursLocal(params.aggregateTotals.hours)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkový orientační výdělek: ${formatKc(params.aggregateTotals.pendingKc)}`, MARGIN_MM, y, CONTENT_W);
    y = addLines(doc, `Celkový schválený výdělek: ${formatKc(params.aggregateTotals.approvedKc)}`, MARGIN_MM, y, CONTENT_W);
  }

  return doc;
}

export function downloadAttendanceOverviewPdf(
  params: AttendanceOverviewPdfParams,
  fileNameBase: string
): void {
  const doc = buildAttendanceOverviewPdf(params);
  doc.save(fileNameBase.endsWith(".pdf") ? fileNameBase : `${fileNameBase}.pdf`);
}
