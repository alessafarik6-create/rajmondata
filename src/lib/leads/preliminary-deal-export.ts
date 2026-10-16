import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { buildCompanyRegisteredAddress } from "@/lib/inquiry-offer-footer";
import { formatCurrency } from "@/lib/pdf/exportJobsToPdf";
import { PDF_FONT_FAMILY } from "@/lib/pdf/register-dejavu-font";
import { registerDejaVuFontsForPdfSync } from "@/lib/pdf/register-dejavu-font-server";
import {
  PRELIMINARY_DEAL_STATUS_LABELS,
  preliminaryDealPriceLabel,
  type PreliminaryDealDoc,
  type PreliminaryDealStatus,
} from "@/lib/leads/preliminary-deal-types";
import {
  computePreliminaryDealsStatusBreakdown,
  computePreliminaryDealsSummary,
  computePreliminaryDealsVatRecap,
} from "@/lib/leads/preliminary-deal-summary";

export type PreliminaryDealExportRow = PreliminaryDealDoc & { id: string };

export type PreliminaryDealCompanyProfile = {
  name: string;
  address: string | null;
  ico: string | null;
  dic: string | null;
  email: string | null;
  phone: string | null;
  logoDataUrl: string | null;
};

const MARGIN_MM = 14;
const ORANGE_RGB: [number, number, number] = [234, 88, 12];
const HEAD_GRAY: [number, number, number] = [241, 245, 249];
const INK: [number, number, number] = [15, 23, 42];

function trimStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function companyDocToPreliminaryDealProfile(
  companyDoc: Record<string, unknown> | null | undefined,
  logoDataUrl?: string | null
): PreliminaryDealCompanyProfile {
  const c = companyDoc ?? {};
  const name =
    trimStr(c.name ?? c.displayName ?? c.companyName) || "Organizace";
  const address = buildCompanyRegisteredAddress(c);
  const ico = trimStr(c.ico ?? c.companyIco) || null;
  const dic = trimStr(c.dic ?? c.companyDic) || null;
  const email = trimStr(c.email ?? c.contactEmail ?? c.companyEmail) || null;
  const phone = trimStr(c.phone ?? c.companyPhone) || null;
  const logoFromDoc = trimStr(c.organizationLogoUrl) || null;
  return {
    name,
    address,
    ico,
    dic,
    email,
    phone,
    logoDataUrl: logoDataUrl ?? logoFromDoc,
  };
}

export async function fetchLogoAsDataUrl(url: string | null | undefined): Promise<string | null> {
  const u = trimStr(url);
  if (!u) return null;
  if (u.startsWith("data:image/")) return u;
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    return `data:${ct.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function formatDateCs(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

function formatCreatedAt(raw: unknown): string {
  if (!raw) return "—";
  if (typeof raw === "string") return formatDateCs(raw);
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate().toLocaleDateString("cs-CZ", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  }
  return "—";
}

export function formatPreliminaryDealsPeriodLabel(
  dateFrom?: string | null,
  dateTo?: string | null
): string {
  const from = trimStr(dateFrom);
  const to = trimStr(dateTo);
  if (from && to) return `${formatDateCs(from)} – ${formatDateCs(to)}`;
  if (from) return `od ${formatDateCs(from)}`;
  if (to) return `do ${formatDateCs(to)}`;
  return "Všechna období (dle filtru exportu)";
}

function addRajmondataFooters(doc: jsPDF, generatedAt: Date): void {
  const pageCount = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const stamp = generatedAt.toLocaleString("cs-CZ");
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("Vygenerováno systémem RAJMONDATA.cz", MARGIN_MM, pageH - 10);
    doc.text(`Export: ${stamp}`, MARGIN_MM, pageH - 6);
    doc.text("Částky jsou předběžné a nejsou závaznou nabídkou.", MARGIN_MM, pageH - 2);
    doc.text(`Strana ${i} / ${pageCount}`, pageW - MARGIN_MM, pageH - 6, { align: "right" });
  }
  doc.setTextColor(...INK);
}

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  return "JPEG";
}

function drawCompanyLetterhead(
  doc: jsPDF,
  profile: PreliminaryDealCompanyProfile,
  documentCreatedLabel: string
): number {
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN_MM;
  const textX = profile.logoDataUrl ? MARGIN_MM + 26 : MARGIN_MM;

  if (profile.logoDataUrl) {
    try {
      const fmt = detectImageFormat(profile.logoDataUrl);
      doc.addImage(profile.logoDataUrl, fmt, MARGIN_MM, y, 22, 22);
    } catch {
      /* bez loga */
    }
  }

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(profile.name, textX, y + 6);

  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  let lineY = y + 11;
  const metaLines: string[] = [];
  if (profile.address) metaLines.push(...profile.address.split("\n").filter(Boolean));
  if (profile.ico) metaLines.push(`IČO: ${profile.ico}`);
  if (profile.dic) metaLines.push(`DIČ: ${profile.dic}`);
  if (profile.phone) metaLines.push(`Tel.: ${profile.phone}`);
  if (profile.email) metaLines.push(profile.email);
  for (const line of metaLines.slice(0, 6)) {
    doc.text(line, textX, lineY);
    lineY += 4.2;
  }

  doc.setFontSize(8.5);
  doc.text(`Datum vytvoření dokumentu: ${documentCreatedLabel}`, pageW - MARGIN_MM, y + 5, {
    align: "right",
  });

  y = Math.max(y + 24, lineY + 2);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_MM, y, pageW - MARGIN_MM, y);
  return y + 6;
}

function drawSectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...ORANGE_RGB);
  doc.text(title, MARGIN_MM, y);
  doc.setTextColor(...INK);
  return y + 5;
}

function drawLabelValueRows(
  doc: jsPDF,
  startY: number,
  rows: [string, string][]
): number {
  let y = startY;
  const labelW = 52;
  const valueW = doc.internal.pageSize.getWidth() - MARGIN_MM * 2 - labelW;
  for (const [label, value] of rows) {
    if (y > 265) {
      doc.addPage();
      y = MARGIN_MM + 8;
    }
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(9.5);
    doc.text(`${label}:`, MARGIN_MM, y);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    const wrapped = doc.splitTextToSize(value || "—", valueW);
    doc.text(wrapped, MARGIN_MM + labelW, y);
    y += Math.max(5.5, wrapped.length * 4.8);
  }
  return y;
}

function compactCellText(text: string, maxLen: number): string {
  const t = trimStr(text).replace(/\s+/g, " ");
  if (t.length <= maxLen) return t || "—";
  return `${t.slice(0, maxLen - 1).trim()}…`;
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

export async function exportSinglePreliminaryDealPdfBuffer(
  row: PreliminaryDealExportRow,
  profile: PreliminaryDealCompanyProfile
): Promise<Buffer> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerDejaVuFontsForPdfSync(doc);
  const generatedAt = new Date();
  const docDate = generatedAt.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  let y = drawCompanyLetterhead(doc, profile, docDate);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(15);
  doc.setTextColor(...ORANGE_RGB);
  doc.text("PŘEDJEDNANÁ ZAKÁZKA", MARGIN_MM, y);
  doc.setTextColor(...INK);
  y += 10;

  y = drawSectionTitle(doc, y, "Informace o zakázce");
  y = drawLabelValueRows(doc, y, [
    ["Název zakázky", row.title],
    ["Popis práce", row.description || "—"],
    [
      "Stav",
      PRELIMINARY_DEAL_STATUS_LABELS[row.status as PreliminaryDealStatus] ?? row.status,
    ],
    ["Datum vytvoření", formatCreatedAt(row.createdAt)],
    ["Termín realizace", formatDateCs(row.expectedCompletionDate ?? undefined)],
    [
      "Datum potvrzení",
      formatDateCs(row.expectedConfirmationDate ?? undefined),
    ],
  ]);

  y += 3;
  y = drawSectionTitle(doc, y, "Zákazník");
  y = drawLabelValueRows(doc, y, [
    ["Jméno / firma", row.customerName ?? "—"],
    ["Telefon", row.customerPhone ?? "—"],
    ["E-mail", row.customerEmail ?? "—"],
  ]);

  y += 3;
  y = drawSectionTitle(doc, y, "Finanční informace");
  y = drawLabelValueRows(doc, y, [
    [
      "Předběžná cena",
      preliminaryDealPriceLabel(Number(row.priceAmount) || 0, row.priceVatMode),
    ],
    [
      "Režim DPH",
      row.priceVatMode === "with_vat" ? "Cena s DPH" : "Cena bez DPH",
    ],
  ]);

  y += 3;
  y = drawSectionTitle(doc, y, "Odpovědná osoba");
  y = drawLabelValueRows(doc, y, [["Jméno", row.responsibleEmployeeName ?? "—"]]);

  if (row.note?.trim()) {
    y += 3;
    y = drawSectionTitle(doc, y, "Poznámky");
    y = drawLabelValueRows(doc, y, [["Poznámka", row.note.trim()]]);
  }

  y += 6;
  doc.setFillColor(255, 247, 237);
  doc.setDrawColor(...ORANGE_RGB);
  doc.setLineWidth(0.2);
  doc.roundedRect(MARGIN_MM, y, doc.internal.pageSize.getWidth() - MARGIN_MM * 2, 22, 2, 2, "FD");
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(154, 52, 18);
  doc.text(
    "Tento dokument představuje předběžný záznam zakázky a není závaznou smlouvou ani cenovou nabídkou.",
    MARGIN_MM + 4,
    y + 8,
    { maxWidth: doc.internal.pageSize.getWidth() - MARGIN_MM * 2 - 8 }
  );

  addRajmondataFooters(doc, generatedAt);
  return Buffer.from(doc.output("arraybuffer"));
}

export async function exportPreliminaryDealsListPdfBuffer(
  rows: PreliminaryDealExportRow[],
  profile: PreliminaryDealCompanyProfile,
  periodLabel: string,
  filtersLabel?: string | null
): Promise<Buffer> {
  const summary = computePreliminaryDealsSummary(rows);
  const vatRecap = computePreliminaryDealsVatRecap(rows);
  const statusBreakdown = computePreliminaryDealsStatusBreakdown(rows);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerDejaVuFontsForPdfSync(doc);
  const generatedAt = new Date();
  const docDate = generatedAt.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  let y = drawCompanyLetterhead(doc, profile, docDate);
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(13);
  doc.setTextColor(...ORANGE_RGB);
  doc.text("PŘEHLED PŘEDJEDNANÝCH ZAKÁZEK", MARGIN_MM, y);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  let metaY = y + 5.5;
  doc.text(`Období: ${periodLabel}`, MARGIN_MM, metaY);
  metaY += 4;
  const filters = trimStr(filtersLabel) || "Bez dalších filtrů";
  doc.text(`Filtry: ${filters}`, MARGIN_MM, metaY, {
    maxWidth: doc.internal.pageSize.getWidth() - MARGIN_MM * 2,
  });
  metaY += 4;
  doc.text(
    `Počet zakázek: ${summary.count} · Celková předběžná hodnota (pipeline): ${formatCurrency(summary.pipelineValue)}`,
    MARGIN_MM,
    metaY
  );
  doc.setTextColor(...INK);
  y = metaY + 6;

  const tableBody = rows.map((r, idx) => [
    String(idx + 1),
    compactCellText(r.title, 80),
    compactCellText(r.customerName ?? "—", 48),
    compactCellText(r.description || "—", 110),
    formatDateCs(r.expectedCompletionDate ?? undefined),
    preliminaryDealPriceLabel(Number(r.priceAmount) || 0, r.priceVatMode),
    PRELIMINARY_DEAL_STATUS_LABELS[r.status as PreliminaryDealStatus] ?? r.status,
  ]);

  const pageW = doc.internal.pageSize.getWidth();
  autoTable(doc, {
    startY: y,
    head: [["Č.", "Název zakázky", "Zákazník", "Popis práce", "Termín", "Cena", "Stav"]],
    body: tableBody,
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: 7.5,
      cellPadding: 1.2,
      overflow: "linebreak",
      valign: "top",
      textColor: INK,
      lineColor: [226, 232, 240],
      lineWidth: 0.12,
      minCellHeight: 5,
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: HEAD_GRAY,
      textColor: INK,
      fontSize: 7.5,
      cellPadding: 1.4,
    },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 26 },
      2: { cellWidth: 22 },
      3: { cellWidth: 38 },
      4: { cellWidth: 17 },
      5: { halign: "right", cellWidth: 20 },
      6: { cellWidth: 20 },
    },
    margin: { left: MARGIN_MM, right: MARGIN_MM, top: MARGIN_MM, bottom: 16 },
    tableWidth: pageW - MARGIN_MM * 2,
  });

  let footY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  footY += 6;
  if (footY > 248) {
    doc.addPage();
    footY = MARGIN_MM + 6;
  }

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(9);
  doc.text("Souhrn podle stavu", MARGIN_MM, footY);
  footY += 4.5;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8);
  for (const row of statusBreakdown) {
    const label =
      PRELIMINARY_DEAL_STATUS_LABELS[row.status as PreliminaryDealStatus] ?? row.status;
    doc.text(
      `${label}: ${row.count} ks · ${formatCurrency(row.value)}`,
      MARGIN_MM,
      footY
    );
    footY += 3.8;
  }
  footY += 2;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(9);
  doc.text("Finanční rekapitulace (bez sčítání režimů DPH)", MARGIN_MM, footY);
  footY += 4.5;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(8);
  doc.text(
    `Ceny s DPH: ${vatRecap.countWithVat} ks · ${formatCurrency(vatRecap.totalWithVat)}`,
    MARGIN_MM,
    footY
  );
  footY += 3.8;
  doc.text(
    `Ceny bez DPH: ${vatRecap.countWithoutVat} ks · ${formatCurrency(vatRecap.totalWithoutVat)}`,
    MARGIN_MM,
    footY
  );
  footY += 3.8;
  doc.text(
    `Pipeline celkem (smíšené režimy): ${formatCurrency(summary.pipelineValue)}`,
    MARGIN_MM,
    footY
  );

  addRajmondataFooters(doc, generatedAt);
  return Buffer.from(doc.output("arraybuffer"));
}
