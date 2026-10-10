import { jsPDF } from "jspdf";
import { PDF_FONT_FAMILY, registerDejaVuFontsForPdf } from "@/lib/pdf/register-dejavu-font";

export type ProductionQrPdfTask = {
  name: string;
  nameUk?: string | null;
  description?: string | null;
  descriptionUk?: string | null;
  scanUrl: string;
  status: string;
  qrDataUrl: string;
};

export type BuildProductionQrTasksPdfOptions = {
  jobNumberLabel: string;
  jobName: string;
  tasks: ProductionQrPdfTask[];
  fontBasePath?: string;
};

const TASKS_PER_PAGE = 3;
/** ~55 mm ≈ 5,5 cm QR pro spolehlivé skenování */
const QR_SIZE_MM = 55;
const MARGIN = 12;
const GAP = 6;

function splitLines(doc: jsPDF, text: string, maxW: number): string[] {
  return doc.splitTextToSize(text, maxW) as string[];
}

type ProductionQrPdfTaskInternal = ProductionQrPdfTask & { jobLine?: string };

function drawTaskBlock(
  doc: jsPDF,
  yTop: number,
  pageW: number,
  task: ProductionQrPdfTaskInternal
): number {
  const blockH = (297 - 2 * MARGIN - 2 * GAP) / TASKS_PER_PAGE;
  const innerPad = 4;
  const x0 = MARGIN;
  const y0 = yTop;
  const w = pageW - 2 * MARGIN;

  doc.setDrawColor(40);
  doc.setLineWidth(0.3);
  doc.roundedRect(x0, y0, w, blockH - GAP, 2, 2);

  const qrX = x0 + innerPad;
  const qrY = y0 + innerPad + (blockH - GAP - QR_SIZE_MM) / 2 - 2;
  try {
    doc.addImage(task.qrDataUrl, "PNG", qrX, qrY, QR_SIZE_MM, QR_SIZE_MM);
  } catch {
    doc.text("QR", qrX + 10, qrY + 20);
  }

  const textX = qrX + QR_SIZE_MM + innerPad + 2;
  const textW = w - (textX - x0) - innerPad;
  let ty = y0 + innerPad + 2;

  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(9);
  doc.text("Zakázka / Замовлення", textX, ty);
  ty += 4;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(10);
  for (const line of splitLines(doc, task.jobLine ?? "", textW)) {
    doc.text(line, textX, ty);
    ty += 4.5;
  }

  ty += 2;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(9);
  doc.text("Výrobní úkol / Виробниче завдання", textX, ty);
  ty += 4;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(10);
  const nameCs = task.name.trim();
  const nameUa = String(task.nameUk ?? "").trim();
  for (const line of splitLines(doc, nameCs, textW)) {
    doc.text(line, textX, ty);
    ty += 4.5;
  }
  if (nameUa) {
    doc.setFontSize(9);
    for (const line of splitLines(doc, nameUa, textW)) {
      doc.text(line, textX, ty);
      ty += 4.2;
    }
    doc.setFontSize(10);
  }

  ty += 2;
  doc.setFont(PDF_FONT_FAMILY, "bold");
  doc.setFontSize(9);
  doc.text("Popis práce / Опис роботи", textX, ty);
  ty += 4;
  doc.setFont(PDF_FONT_FAMILY, "normal");
  doc.setFontSize(9);
  const descCs = String(task.description ?? "").trim() || "—";
  const descUa = String(task.descriptionUk ?? "").trim();
  for (const line of splitLines(doc, descCs, textW)) {
    if (ty > y0 + blockH - GAP - 14) break;
    doc.text(line, textX, ty);
    ty += 4;
  }
  if (descUa && ty < y0 + blockH - GAP - 10) {
    for (const line of splitLines(doc, descUa, textW)) {
      if (ty > y0 + blockH - GAP - 14) break;
      doc.text(line, textX, ty);
      ty += 3.8;
    }
  }

  const footY = y0 + blockH - GAP - 5;
  doc.setFontSize(8);
  doc.setTextColor(50);
  doc.text(
    "Naskenujte QR kód pro zahájení práce / Скануйте QR-код, щоб розпочати роботу",
    textX,
    footY
  );
  if (task.status === "done") {
    doc.setTextColor(120);
    doc.text("Dokončeno / Завершено", x0 + w - innerPad - 28, y0 + innerPad + 3);
  }
  doc.setTextColor(0);

  return blockH;
}

export async function buildProductionQrTasksPdf(
  opts: BuildProductionQrTasksPdfOptions
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  await registerDejaVuFontsForPdf(doc, opts.fontBasePath ?? "/fonts");
  const pageW = doc.internal.pageSize.getWidth();
  const jobLine = [opts.jobNumberLabel, opts.jobName].filter(Boolean).join(" · ");

  const tasks: ProductionQrPdfTaskInternal[] = opts.tasks.map((t) => ({
    ...t,
    jobLine,
  }));

  const blockH = (297 - 2 * MARGIN - 2 * GAP) / TASKS_PER_PAGE;

  for (let i = 0; i < tasks.length; i++) {
    const pageIndex = Math.floor(i / TASKS_PER_PAGE);
    const indexOnPage = i % TASKS_PER_PAGE;
    if (pageIndex > 0 && indexOnPage === 0) doc.addPage();
    const yTop = MARGIN + indexOnPage * blockH;
    drawTaskBlock(doc, yTop, pageW, tasks[i]!);
  }

  if (tasks.length === 0) {
    doc.setFontSize(12);
    doc.text("Žádné výrobní úkoly k tisku.", MARGIN, 40);
  }

  return doc.output("blob");
}
