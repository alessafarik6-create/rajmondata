/**
 * Export reportů organizace do PDF a CSV (aktuální záložka).
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { formatCurrency } from "@/lib/pdf/exportJobsToPdf";
import {
  type OrganizationReportsData,
  type ReportTab,
  REPORT_TAB_LABELS,
  formatReportDate,
} from "@/lib/organization-reports";

const MARGIN_MM = 14;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN_MM * 2;
const PAGE_BOTTOM = 287;

function safeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(rows: string[][], fileName: string) {
  const body = rows.map((r) => r.map(safeCsvCell).join(";")).join("\r\n");
  const bom = "\uFEFF";
  downloadBlob(new Blob([bom + body], { type: "text/csv;charset=utf-8" }), fileName);
}

function addSectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  doc.text(title, MARGIN_MM, y);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  return y + 6;
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  if (y + need > PAGE_BOTTOM) {
    doc.addPage();
    return MARGIN_MM + 8;
  }
  return y;
}

function kpiLines(
  data: OrganizationReportsData,
  tab: ReportTab
): [string, string][] {
  const o = data.overview;
  const j = data.jobs;
  const f = data.financials;
  const e = data.employees;

  switch (tab) {
    case "overview":
      return [
        ["Příjmy (letos)", formatCurrency(o.ytdRevenue)],
        ["Náklady (letos)", formatCurrency(o.ytdCosts)],
        ["Zisk (letos)", formatCurrency(o.ytdProfit)],
        [
          "Marže (letos)",
          o.marginPct == null ? "—" : `${o.marginPct.toFixed(1)} %`,
        ],
        ["Aktivní zakázky", String(o.activeJobsCount)],
        ["Dokončené zakázky", String(o.completedJobsCount)],
        ["Nefakturované zakázky", String(o.unfacturedJobsCount)],
        [
          "Průměrný rozpočet zakázky",
          o.avgJobBudget == null ? "—" : formatCurrency(o.avgJobBudget),
        ],
      ];
    case "employees":
      return [
        ["Počet zaměstnanců", String(e.totalCount)],
        ["Odpracované hodiny (letos)", `${e.totalHoursYtd} h`],
      ];
    case "jobs":
      return [
        ["Aktivní zakázky", String(j.activeCount)],
        ["Dokončené zakázky", String(j.completedCount)],
        ["Nefakturované zakázky", String(j.unfacturedCount)],
        [
          "Průměrný rozpočet",
          j.avgBudget == null ? "—" : formatCurrency(j.avgBudget),
        ],
      ];
    case "financials":
      return [
        ["Příjmy (letos)", formatCurrency(f.ytdRevenue)],
        ["Náklady (letos)", formatCurrency(f.ytdCosts)],
        ["Zisk (letos)", formatCurrency(f.ytdProfit)],
        [
          "Marže (letos)",
          f.marginPct == null ? "—" : `${f.marginPct.toFixed(1)} %`,
        ],
        ["Aktivní zakázky", String(f.activeJobsCount)],
        ["Dokončené zakázky", String(f.completedJobsCount)],
        ["Nefakturované zakázky", String(f.unfacturedJobsCount)],
        [
          "Průměrný rozpočet zakázky",
          f.avgJobBudget == null ? "—" : formatCurrency(f.avgJobBudget),
        ],
      ];
  }
}

export type ExportOrganizationReportOptions = {
  tab: ReportTab;
  data: OrganizationReportsData;
  companyName: string;
  exportedAt?: Date;
  fileNamePrefix?: string;
};

export function buildOrganizationReportCsvRows(
  tab: ReportTab,
  data: OrganizationReportsData
): string[][] {
  const rows: string[][] = [
    ["Položka", "Hodnota"],
    ...kpiLines(data, tab),
  ];

  switch (tab) {
    case "overview":
    case "financials": {
      const monthly =
        tab === "overview" ? data.overview.monthlyBarData : data.financials.monthlyBarData;
      if (monthly.length) {
        rows.push([], ["Měsíc", "Příjmy (Kč)", "Náklady (Kč)"]);
        for (const m of monthly) {
          rows.push([m.name, String(Math.round(m.revenue)), String(Math.round(m.costs))]);
        }
      }
      if (tab === "financials" && data.financials.expenseStructure.length) {
        rows.push([], ["Kategorie nákladů", "Částka (Kč)"]);
        for (const p of data.financials.expenseStructure) {
          rows.push([p.name, String(Math.round(p.value))]);
        }
      }
      break;
    }
    case "employees": {
      if (data.employees.rolePieData.length) {
        rows.push([], ["Role", "Počet"]);
        for (const p of data.employees.rolePieData) {
          rows.push([p.name, String(p.value)]);
        }
      }
      if (data.employees.hoursByMonth.length) {
        rows.push([], ["Měsíc", "Odpracované hodiny"]);
        for (const m of data.employees.hoursByMonth) {
          rows.push([m.name, String(m.hours)]);
        }
      }
      if (data.employees.hoursByEmployee.length) {
        rows.push([], ["Zaměstnanec", "Role", "Hodiny (letos)"]);
        for (const h of data.employees.hoursByEmployee) {
          rows.push([h.name, h.role, String(h.hours)]);
        }
      }
      break;
    }
    case "jobs": {
      if (data.jobs.statusBreakdown.length) {
        rows.push([], ["Stav zakázky", "Počet"]);
        for (const s of data.jobs.statusBreakdown) {
          rows.push([s.name, String(s.count)]);
        }
      }
      if (data.jobs.jobProfitChart.length) {
        rows.push([], ["Zakázka", "Zisk (Kč)"]);
        for (const j of data.jobs.jobProfitChart) {
          rows.push([j.name, String(Math.round(j.profit))]);
        }
      }
      break;
    }
  }

  return rows;
}

export function exportOrganizationReportCsv(
  options: ExportOrganizationReportOptions
): void {
  const rows = buildOrganizationReportCsvRows(options.tab, options.data);
  if (rows.length <= 1) {
    throw new Error("Žádná data k exportu.");
  }
  const tabSlug = options.tab;
  const prefix = options.fileNamePrefix ?? "report";
  const safeOrg = (options.companyName || "organizace")
    .replace(/[^\w\d\-]+/gi, "_")
    .slice(0, 40);
  downloadCsv(
    rows,
    `${prefix}_${safeOrg}_${tabSlug}_${options.data.year}.csv`
  );
}

export async function exportOrganizationReportPdf(
  options: ExportOrganizationReportOptions
): Promise<void> {
  const { tab, data, companyName } = options;
  const exportedAt = options.exportedAt ?? new Date();
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  await registerDejaVuFontsForPdf(doc);

  let y = MARGIN_MM + 4;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(15);
  doc.text("Analytika a reporty", MARGIN_MM, y);
  y += 8;

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(10);
  doc.text(`Organizace: ${companyName || "—"}`, MARGIN_MM, y);
  y += 5;
  doc.text(`Záložka: ${REPORT_TAB_LABELS[tab]}`, MARGIN_MM, y);
  y += 5;
  doc.text(`Období: rok ${data.year}`, MARGIN_MM, y);
  y += 5;
  doc.text(`Export: ${formatReportDate(exportedAt)}`, MARGIN_MM, y);
  y += 8;

  y = addSectionTitle(doc, y, "Souhrnné karty");
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_MM, right: MARGIN_MM },
    head: [["Ukazatel", "Hodnota"]],
    body: kpiLines(data, tab),
    styles: { font: PDF_FONT_FAMILY, fontSize: 9, cellPadding: 2 },
    headStyles: { font: PDF_FONT_FAMILY, fontStyle: "bold", fillColor: [241, 245, 249] },
    theme: "grid",
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const addTable = (title: string, head: string[], body: string[][]) => {
    if (!body.length) return;
    y = ensureSpace(doc, y, 20);
    y = addSectionTitle(doc, y, title);
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN_MM, right: MARGIN_MM },
      head: [head],
      body,
      styles: { font: PDF_FONT_FAMILY, fontSize: 8, cellPadding: 2 },
      headStyles: { font: PDF_FONT_FAMILY, fontStyle: "bold", fillColor: [241, 245, 249] },
      theme: "grid",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  };

  if (tab === "overview" || tab === "financials") {
    const monthly =
      tab === "overview" ? data.overview.monthlyBarData : data.financials.monthlyBarData;
    if (monthly.length) {
      addTable(
        "Graf: měsíční příjmy a náklady (tabulka)",
        ["Měsíc", "Příjmy", "Náklady"],
        monthly.map((m) => [
          m.name,
          formatCurrency(m.revenue),
          formatCurrency(m.costs),
        ])
      );
    }
    if (tab === "financials" && data.financials.expenseStructure.length) {
      addTable(
        "Graf: struktura nákladů (tabulka)",
        ["Kategorie", "Částka"],
        data.financials.expenseStructure.map((p) => [
          p.name,
          formatCurrency(p.value),
        ])
      );
    }
  }

  if (tab === "employees") {
    if (data.employees.rolePieData.length) {
      addTable(
        "Graf: složení rolí (tabulka)",
        ["Role", "Počet"],
        data.employees.rolePieData.map((p) => [p.name, String(p.value)])
      );
    }
    if (data.employees.hoursByMonth.length) {
      addTable(
        "Graf: odpracované hodiny po měsících (tabulka)",
        ["Měsíc", "Hodiny"],
        data.employees.hoursByMonth.map((m) => [m.name, `${m.hours} h`])
      );
    }
    if (data.employees.hoursByEmployee.length) {
      addTable(
        "Odpracované hodiny podle zaměstnance",
        ["Zaměstnanec", "Role", "Hodiny"],
        data.employees.hoursByEmployee.map((h) => [
          h.name,
          h.role,
          `${h.hours} h`,
        ])
      );
    }
  }

  if (tab === "jobs") {
    if (data.jobs.statusBreakdown.length) {
      addTable(
        "Přehled stavů zakázek",
        ["Stav", "Počet"],
        data.jobs.statusBreakdown.map((s) => [s.name, String(s.count)])
      );
    }
    if (data.jobs.jobProfitChart.length) {
      addTable(
        "Graf: zisk zakázek (tabulka)",
        ["Zakázka", "Zisk"],
        data.jobs.jobProfitChart.map((j) => [j.name, formatCurrency(j.profit)])
      );
    }
  }

  if (tab === "financials") {
    addTable("Rychlé údaje", ["Položka", "Hodnota"], [
      ["Aktivní zakázky", String(data.financials.activeJobsCount)],
      ["Dokončené zakázky", String(data.financials.completedJobsCount)],
      ["Nefakturované zakázky", String(data.financials.unfacturedJobsCount)],
      [
        "Průměrný rozpočet",
        data.financials.avgJobBudget == null
          ? "—"
          : formatCurrency(data.financials.avgJobBudget),
      ],
    ]);
  }

  const prefix = options.fileNamePrefix ?? "report";
  const safeOrg = (companyName || "organizace")
    .replace(/[^\w\d\-]+/gi, "_")
    .slice(0, 40);
  doc.save(`${prefix}_${safeOrg}_${tab}_${data.year}.pdf`);
}
