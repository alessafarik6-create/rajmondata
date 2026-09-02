/**
 * JSON schema a Zod validace výstupu AI extrakce dokladu.
 */

import { z } from "zod";
import type { DocumentAiExtractionRaw } from "@/lib/ai/document-extraction-types";

const nullableString = z.union([z.string(), z.null()]);
const nullableNumber = z.union([z.number(), z.null()]);

const partySchema = z.object({
  name: nullableString,
  ico: nullableString,
  dic: nullableString,
  address: nullableString,
});

const vatItemSchema = z.object({
  rate: nullableNumber,
  base: nullableNumber,
  vat: nullableNumber,
});

const lineItemSchema = z.object({
  description: nullableString,
  quantity: nullableNumber,
  unit: nullableString,
  unitPriceWithoutVat: nullableNumber,
  vatRate: nullableNumber,
  totalWithoutVat: nullableNumber,
});

const fieldConfidencesSchema = z.object({
  documentNumber: nullableNumber,
  supplierName: nullableNumber,
  issueDate: nullableNumber,
  dueDate: nullableNumber,
  amountWithoutVat: nullableNumber,
  vatAmount: nullableNumber,
  amountWithVat: nullableNumber,
  currency: nullableNumber,
  costCategory: nullableNumber,
});

export const DocumentAiExtractionSchema = z.object({
  documentReadable: z.boolean(),
  unreadableReason: nullableString,
  documentType: nullableString,
  direction: nullableString,
  documentNumber: nullableString,
  variableSymbol: nullableString,
  supplier: partySchema,
  customer: partySchema,
  issueDate: nullableString,
  taxDate: nullableString,
  dueDate: nullableString,
  currency: nullableString,
  amountWithoutVat: nullableNumber,
  vatAmount: nullableNumber,
  amountWithVat: nullableNumber,
  vatBreakdown: z.array(vatItemSchema),
  paymentMethod: nullableString,
  bankAccount: nullableString,
  iban: nullableString,
  note: nullableString,
  items: z.array(lineItemSchema),
  suggestedCategory: nullableString,
  confidence: nullableNumber,
  fieldConfidences: fieldConfidencesSchema,
  warnings: z.array(z.string()),
});

export function parseDocumentAiExtraction(raw: unknown): DocumentAiExtractionRaw {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 && end > start ? t.slice(start, end + 1) : t);
  }
  return DocumentAiExtractionSchema.parse(parsed) as DocumentAiExtractionRaw;
}

const partyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: ["string", "null"] },
    ico: { type: ["string", "null"] },
    dic: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
  },
  required: ["name", "ico", "dic", "address"],
} as const;

const vatItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rate: { type: ["number", "null"] },
    base: { type: ["number", "null"] },
    vat: { type: ["number", "null"] },
  },
  required: ["rate", "base", "vat"],
} as const;

const lineItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: ["string", "null"] },
    quantity: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    unitPriceWithoutVat: { type: ["number", "null"] },
    vatRate: { type: ["number", "null"] },
    totalWithoutVat: { type: ["number", "null"] },
  },
  required: [
    "description",
    "quantity",
    "unit",
    "unitPriceWithoutVat",
    "vatRate",
    "totalWithoutVat",
  ],
} as const;

export const DOCUMENT_AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentReadable: { type: "boolean" },
    unreadableReason: { type: ["string", "null"] },
    documentType: { type: ["string", "null"] },
    direction: { type: ["string", "null"] },
    documentNumber: { type: ["string", "null"] },
    variableSymbol: { type: ["string", "null"] },
    supplier: partyJsonSchema,
    customer: partyJsonSchema,
    issueDate: { type: ["string", "null"] },
    taxDate: { type: ["string", "null"] },
    dueDate: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    amountWithoutVat: { type: ["number", "null"] },
    vatAmount: { type: ["number", "null"] },
    amountWithVat: { type: ["number", "null"] },
    vatBreakdown: { type: "array", items: vatItemJsonSchema },
    paymentMethod: { type: ["string", "null"] },
    bankAccount: { type: ["string", "null"] },
    iban: { type: ["string", "null"] },
    note: { type: ["string", "null"] },
    items: { type: "array", items: lineItemJsonSchema },
    suggestedCategory: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
    fieldConfidences: {
      type: "object",
      additionalProperties: false,
      properties: {
        documentNumber: { type: ["number", "null"] },
        supplierName: { type: ["number", "null"] },
        issueDate: { type: ["number", "null"] },
        dueDate: { type: ["number", "null"] },
        amountWithoutVat: { type: ["number", "null"] },
        vatAmount: { type: ["number", "null"] },
        amountWithVat: { type: ["number", "null"] },
        currency: { type: ["number", "null"] },
        costCategory: { type: ["number", "null"] },
      },
      required: [
        "documentNumber",
        "supplierName",
        "issueDate",
        "dueDate",
        "amountWithoutVat",
        "vatAmount",
        "amountWithVat",
        "currency",
        "costCategory",
      ],
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "documentReadable",
    "unreadableReason",
    "documentType",
    "direction",
    "documentNumber",
    "variableSymbol",
    "supplier",
    "customer",
    "issueDate",
    "taxDate",
    "dueDate",
    "currency",
    "amountWithoutVat",
    "vatAmount",
    "amountWithVat",
    "vatBreakdown",
    "paymentMethod",
    "bankAccount",
    "iban",
    "note",
    "items",
    "suggestedCategory",
    "confidence",
    "fieldConfidences",
    "warnings",
  ],
} as const;
