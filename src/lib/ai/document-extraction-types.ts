/**
 * Typy pro AI extrakci údajů z obchodních dokladů.
 */

export type DocumentCostCategoryKey = "material" | "work" | "transport" | "other";

export type DocumentAiParty = {
  name: string | null;
  ico: string | null;
  dic: string | null;
  address: string | null;
};

export type DocumentAiVatBreakdownItem = {
  rate: number | null;
  base: number | null;
  vat: number | null;
};

export type DocumentAiLineItem = {
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPriceWithoutVat: number | null;
  vatRate: number | null;
  totalWithoutVat: number | null;
};

export type DocumentAiFieldConfidences = {
  documentNumber: number | null;
  supplierName: number | null;
  issueDate: number | null;
  dueDate: number | null;
  amountWithoutVat: number | null;
  vatAmount: number | null;
  amountWithVat: number | null;
  currency: number | null;
  costCategory: number | null;
};

/** Surový výstup modelu. */
export type DocumentAiExtractionRaw = {
  documentReadable: boolean;
  unreadableReason: string | null;
  documentType: string | null;
  direction: string | null;
  documentNumber: string | null;
  variableSymbol: string | null;
  supplier: DocumentAiParty;
  customer: DocumentAiParty;
  issueDate: string | null;
  taxDate: string | null;
  dueDate: string | null;
  currency: string | null;
  amountWithoutVat: number | null;
  vatAmount: number | null;
  amountWithVat: number | null;
  vatBreakdown: DocumentAiVatBreakdownItem[];
  paymentMethod: string | null;
  bankAccount: string | null;
  iban: string | null;
  note: string | null;
  items: DocumentAiLineItem[];
  suggestedCategory: string | null;
  confidence: number | null;
  fieldConfidences: DocumentAiFieldConfidences;
  warnings: string[];
};

export type DocumentAiDuplicateCandidate = {
  id: string;
  number: string | null;
  entityName: string | null;
  amountNet: number | null;
  date: string | null;
};

export type DocumentAiSuggestedJob = {
  id: string;
  name: string;
  customerName: string | null;
  score: number;
};

export type DocumentAiValidatedResult = {
  readable: boolean;
  unreadableReason: string | null;
  raw: DocumentAiExtractionRaw;
  warnings: string[];
  confidence: number;
  fieldConfidences: DocumentAiFieldConfidences;
  suggestedCategory: DocumentCostCategoryKey | null;
  direction: "received" | "issued";
  formPatch: DocumentAiFormPatch;
  duplicateCandidates: DocumentAiDuplicateCandidate[];
  suggestedJobs: DocumentAiSuggestedJob[];
  supplierMatch: { found: boolean; name: string | null; ico: string | null };
  model: string;
  requestDurationMs: number;
};

/** Mapování do existujícího formuláře dokladů. */
export type DocumentAiFormPatch = {
  number: string;
  entityName: string;
  amount: string;
  currency: "CZK" | "EUR";
  vat: string;
  date: string;
  description: string;
  costCategory: DocumentCostCategoryKey;
  dueDate: string;
  requiresPayment: boolean;
  paymentMethod: "cash" | "bank" | "card" | "other";
  paymentNote: string;
};

export type DocumentAiFilledFields = Partial<Record<keyof DocumentAiFormPatch, boolean>>;

export type DocumentAiLowConfidenceFields = Partial<Record<keyof DocumentAiFormPatch, boolean>>;

export const DOCUMENT_AI_ACCEPTED_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
