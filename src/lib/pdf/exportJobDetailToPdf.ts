import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";
import { fetchImageAsDataUrl, formatCurrency } from "@/lib/pdf/exportJobsToPdf";
import { jobStatusLabel } from "@/lib/job-status";

export type JobDetailPdfSections = {
  summary: boolean;
  financial: boolean;
  budget: boolean;
  invoices: boolean;
  receivedDocs: boolean;
  issuedDocs: boolean;
  deposits: boolean;
  payments: boolean;
  material: boolean;
  labor: boolean;
  meetings: boolean;
  notes: boolean;
};

export type JobDetailPdfInput = {
  companyName: string;
  logoUrl?: string | null;
  jobId: string;
  jobName: string;
  customerName: string;
  status: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  sections: JobDetailPdfSections;
  financialLines?: string[];
  invoiceLines?: string[];
  documentLines?: string[];
  meetingLines?: string[];
  notes?: string;
  fileName?: string;
};

function addPageNumbers(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont(PDF_FONT_FAMILY, "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 110);
    doc.text(
      `Strana ${i} / ${total}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    );
  }
}

export async function exportJobDetailToPdf(input: JobDetailPdfInput): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await registerDejaVuFontsForPdf(doc, "/fonts");
  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();
  let y = margin;

  const logoDataUrl =
    input.logoUrl && input.logoUrl.trim() ? await fetchImageAsDataUrl(input.logoUrl.trim()) : null;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", margin, y, 16, 16);
    } catch {
      /* skip */
    }
  }

  const textX = logoDataUrl ? margin + 20 : margin;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(11);
  doc.setTextColor(234, 88, 12);
  doc.text("RAJMONDATA", textX, y + 5);
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 28);
  doc.text(input.companyName || "Organizace", textX, y + 12);
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  doc.text(`Datum exportu: ${new Date().toLocaleString("cs-CZ")}`, pageW - margin, y + 5, {
    align: "right",
  });
  y += 22;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(13);
  doc.text(input.jobName || "Zakázka", margin, y);
  y += 7;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(10);
  doc.text(`Zákazník: ${input.customerName || "—"}`, margin, y);
  y += 5;
  doc.text(`ID zakázky: ${input.jobId}`, margin, y);
  y += 8;

  const pushSection = (title: string, lines: string[][]) => {
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = margin;
    }
    doc.setFont(PDF_FONT_FAMILY, "bold");
    doc.setFontSize(11);
    doc.text(title, margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Položka", "Hodnota"]],
      body: lines,
      styles: { font: PDF_FONT_FAMILY, fontSize: 9 },
      headStyles: { fillColor: [234, 88, 12] },
      margin: { left: margin, right: margin },
    });
    y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
    y += 8;
  };

  if (input.sections.summary) {
    pushSection("Souhrn zakázky", [
      ["Stav", jobStatusLabel(input.status)],
      ["Zahájení", input.startDate || "—"],
      ["Dokončení", input.endDate || "—"],
      ["Popis", (input.description || "—").slice(0, 500)],
    ]);
  }

  if (input.sections.financial && input.financialLines?.length) {
    pushSection(
      "Finanční souhrn",
      input.financialLines.map((line) => ["", line])
    );
  }

  if (input.sections.invoices && input.invoiceLines?.length) {
    pushSection(
      "Fakturace",
      input.invoiceLines.slice(0, 40).map((line) => ["", line])
    );
  }

  if (
    (input.sections.receivedDocs || input.sections.issuedDocs) &&
    input.documentLines?.length
  ) {
    pushSection(
      "Doklady",
      input.documentLines.slice(0, 40).map((line) => ["", line])
    );
  }

  if (input.sections.meetings && input.meetingLines?.length) {
    pushSection(
      "Schůzky",
      input.meetingLines.slice(0, 30).map((line) => ["", line])
    );
  }

  if (input.sections.notes && input.notes?.trim()) {
    pushSection("Poznámky", [["", input.notes.trim().slice(0, 800)]]);
  }

  if (input.sections.budget) {
    pushSection("Rozpočet", [["", "Detail rozpočtu exportujte z karty Rozpočet práce (PDF)."]]);
  }

  addPageNumbers(doc);
  const safe = (input.fileName || `zakazka-${input.jobId}`).replace(/[^\w.\-]+/g, "_");
  doc.save(`${safe}.pdf`);
}

export { formatCurrency };
