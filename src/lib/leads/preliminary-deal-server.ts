import type { PreliminaryDealDoc, PreliminaryDealPriceVatMode } from "@/lib/leads/preliminary-deal-types";
import {
  isPreliminaryDealStatus,
  normalizePreliminaryDealStatus,
} from "@/lib/leads/preliminary-deal-types";

export function parsePreliminaryDealDoc(
  id: string,
  data: Record<string, unknown> | undefined
): (PreliminaryDealDoc & { id: string }) | null {
  if (!data) return null;
  const title = String(data.title ?? "").trim();
  if (!title) return null;
  const priceAmount = Number(data.priceAmount);
  const priceVatMode: PreliminaryDealPriceVatMode =
    data.priceVatMode === "without_vat" ? "without_vat" : "with_vat";
  return {
    id,
    companyId: String(data.companyId ?? ""),
    title,
    description: String(data.description ?? "").trim(),
    priceAmount: Number.isFinite(priceAmount) ? priceAmount : 0,
    priceVatMode,
    status: normalizePreliminaryDealStatus(data.status),
    customerId: data.customerId != null ? String(data.customerId) : null,
    customerName: data.customerName != null ? String(data.customerName) : null,
    customerPhone: data.customerPhone != null ? String(data.customerPhone) : null,
    customerEmail: data.customerEmail != null ? String(data.customerEmail) : null,
    expectedCompletionDate:
      data.expectedCompletionDate != null ? String(data.expectedCompletionDate) : null,
    expectedConfirmationDate:
      data.expectedConfirmationDate != null ? String(data.expectedConfirmationDate) : null,
    note: data.note != null ? String(data.note) : null,
    responsibleEmployeeId:
      data.responsibleEmployeeId != null ? String(data.responsibleEmployeeId) : null,
    responsibleEmployeeName:
      data.responsibleEmployeeName != null ? String(data.responsibleEmployeeName) : null,
    sourceLeadId: data.sourceLeadId != null ? String(data.sourceLeadId) : null,
    convertedJobId: data.convertedJobId != null ? String(data.convertedJobId) : null,
    convertedAt: data.convertedAt,
    attachments: Array.isArray(data.attachments) ? (data.attachments as PreliminaryDealDoc["attachments"]) : [],
    createdBy: String(data.createdBy ?? ""),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy != null ? String(data.updatedBy) : null,
  };
}

export function sanitizePreliminaryDealInput(body: Record<string, unknown>): Partial<PreliminaryDealDoc> {
  const out: Partial<PreliminaryDealDoc> = {};
  if (body.title !== undefined) out.title = String(body.title).trim();
  if (body.description !== undefined) out.description = String(body.description).trim();
  if (body.priceAmount !== undefined) {
    const n = Number(body.priceAmount);
    out.priceAmount = Number.isFinite(n) ? n : 0;
  }
  if (body.priceVatMode !== undefined) {
    out.priceVatMode = body.priceVatMode === "without_vat" ? "without_vat" : "with_vat";
  }
  if (body.status !== undefined && isPreliminaryDealStatus(body.status)) {
    out.status = body.status;
  }
  const optStr = (k: keyof PreliminaryDealDoc) => {
    if (body[k] === undefined) return;
    const v = body[k];
    if (v === null || v === "") {
      (out as Record<string, unknown>)[k] = null;
    } else {
      (out as Record<string, unknown>)[k] = String(v).trim();
    }
  };
  optStr("customerId");
  optStr("customerName");
  optStr("customerPhone");
  optStr("customerEmail");
  optStr("expectedCompletionDate");
  optStr("expectedConfirmationDate");
  optStr("note");
  optStr("responsibleEmployeeId");
  optStr("responsibleEmployeeName");
  optStr("sourceLeadId");
  if (Array.isArray(body.attachments)) {
    out.attachments = body.attachments as PreliminaryDealDoc["attachments"];
  }
  return out;
}
