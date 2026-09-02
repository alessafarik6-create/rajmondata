/**
 * Validace AI extrakce dokladu a mapování do formuláře (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { parseDocumentAiExtraction } from "@/lib/ai/document-extraction-schema";
import type {
  DocumentAiDuplicateCandidate,
  DocumentAiExtractionRaw,
  DocumentAiFieldConfidences,
  DocumentAiFormPatch,
  DocumentAiSuggestedJob,
  DocumentAiValidatedResult,
  DocumentCostCategoryKey,
} from "@/lib/ai/document-extraction-types";

const VALID_CATEGORIES = new Set<DocumentCostCategoryKey>([
  "material",
  "work",
  "transport",
  "other",
]);

const LOW_CONFIDENCE_THRESHOLD = 0.65;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function strOrEmpty(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function parseIsoDate(raw: string | null): string {
  const s = strOrEmpty(raw);
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return "";
}

function normalizeCurrency(raw: string | null): "CZK" | "EUR" {
  const c = strOrEmpty(raw).toUpperCase();
  if (c === "EUR" || c.includes("€")) return "EUR";
  return "CZK";
}

function resolveVatRate(raw: DocumentAiExtractionRaw): string {
  if (raw.vatBreakdown.length > 0) {
    const rates = raw.vatBreakdown
      .map((v) => (v.rate != null && Number.isFinite(v.rate) ? Math.round(v.rate) : null))
      .filter((r): r is number => r != null);
    if (rates.length === 1) return String(rates[0]);
    if (rates.length > 1) {
      const dominant = rates.sort((a, b) => b - a)[0];
      return String(dominant);
    }
  }
  const net = raw.amountWithoutVat;
  const vat = raw.vatAmount;
  if (net != null && vat != null && net > 0) {
    const rate = Math.round((vat / net) * 100);
    if ([0, 12, 21].includes(rate)) return String(rate);
  }
  return "21";
}

function mapCategory(raw: string | null): DocumentCostCategoryKey | null {
  const s = strOrEmpty(raw).toLowerCase();
  if (VALID_CATEGORIES.has(s as DocumentCostCategoryKey)) {
    return s as DocumentCostCategoryKey;
  }
  if (s.includes("mater")) return "material";
  if (s.includes("prac") || s.includes("work")) return "work";
  if (s.includes("dopr") || s.includes("transport")) return "transport";
  if (s.includes("ostat") || s.includes("other")) return "other";
  return null;
}

function mapPaymentMethod(
  raw: string | null
): DocumentAiFormPatch["paymentMethod"] {
  const s = strOrEmpty(raw).toLowerCase();
  if (s.includes("cash") || s.includes("hotov")) return "cash";
  if (s.includes("card") || s.includes("kart")) return "card";
  if (s.includes("bank") || s.includes("prevod") || s.includes("převod")) {
    return "bank";
  }
  return "bank";
}

function validateAmounts(raw: DocumentAiExtractionRaw, warnings: string[]): void {
  const net = raw.amountWithoutVat;
  const vat = raw.vatAmount;
  const gross = raw.amountWithVat;
  if (net == null || vat == null || gross == null) return;
  if (!Number.isFinite(net) || !Number.isFinite(vat) || !Number.isFinite(gross)) return;
  const sum = roundMoney(net + vat);
  const grossR = roundMoney(gross);
  if (Math.abs(sum - grossR) > 0.05) {
    warnings.push("Částky na dokladu se nepodařilo jednoznačně ověřit.");
  }
}

function buildDescription(raw: DocumentAiExtractionRaw): string {
  const parts: string[] = [];
  if (strOrEmpty(raw.note)) parts.push(strOrEmpty(raw.note));
  if (strOrEmpty(raw.variableSymbol)) {
    parts.push(`VS: ${strOrEmpty(raw.variableSymbol)}`);
  }
  if (strOrEmpty(raw.bankAccount) || strOrEmpty(raw.iban)) {
    parts.push(
      `Účet: ${strOrEmpty(raw.bankAccount) || strOrEmpty(raw.iban)}`.trim()
    );
  }
  if (raw.items.length > 0) {
    const itemLines = raw.items
      .slice(0, 5)
      .map((i) => strOrEmpty(i.description))
      .filter(Boolean);
    if (itemLines.length > 0) {
      parts.push(`Položky: ${itemLines.join("; ")}`);
    }
  }
  return parts.join(" · ").slice(0, 500);
}

function resolveDirection(raw: DocumentAiExtractionRaw): "received" | "issued" {
  const d = strOrEmpty(raw.direction).toLowerCase();
  if (d === "income" || d === "issued" || d === "vydan") return "issued";
  return "received";
}

function buildFormPatch(
  raw: DocumentAiExtractionRaw,
  direction: "received" | "issued"
): DocumentAiFormPatch {
  const entity =
    direction === "received"
      ? strOrEmpty(raw.supplier.name)
      : strOrEmpty(raw.customer.name) || strOrEmpty(raw.supplier.name);

  const amountNet =
    raw.amountWithoutVat != null && Number.isFinite(raw.amountWithoutVat)
      ? String(raw.amountWithoutVat)
      : "";

  const due = parseIsoDate(raw.dueDate);
  const category = mapCategory(raw.suggestedCategory) ?? "other";

  return {
    number: strOrEmpty(raw.documentNumber),
    entityName: entity,
    amount: amountNet,
    currency: normalizeCurrency(raw.currency),
    vat: resolveVatRate(raw),
    date: parseIsoDate(raw.issueDate) || new Date().toISOString().slice(0, 10),
    description: buildDescription(raw),
    costCategory: category,
    dueDate: due,
    requiresPayment: Boolean(due),
    paymentMethod: mapPaymentMethod(raw.paymentMethod),
    paymentNote: strOrEmpty(raw.variableSymbol)
      ? `VS: ${strOrEmpty(raw.variableSymbol)}`
      : "",
  };
}

export async function findDuplicateDocuments(
  db: Firestore,
  companyId: string,
  params: {
    documentNumber: string;
    entityName: string;
    amountNet: number | null;
  }
): Promise<DocumentAiDuplicateCandidate[]> {
  const number = params.documentNumber.trim();
  const entity = params.entityName.trim().toLowerCase();
  if (!number && !entity) return [];

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("documents")
    .limit(200)
    .get();

  const candidates: DocumentAiDuplicateCandidate[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.isDeleted === true) continue;
    const docNumber = strOrEmpty(d.number as string);
    const docEntity = strOrEmpty(d.entityName as string).toLowerCase();
    const docNet =
      d.amountNet != null && Number.isFinite(Number(d.amountNet))
        ? Number(d.amountNet)
        : d.amount != null && Number.isFinite(Number(d.amount))
          ? Number(d.amount)
          : null;

    let match = false;
    if (number && docNumber && docNumber.toLowerCase() === number.toLowerCase()) {
      if (!entity || !docEntity || docEntity.includes(entity) || entity.includes(docEntity)) {
        match = true;
      }
    }
    if (
      !match &&
      entity &&
      docEntity &&
      docEntity === entity &&
      params.amountNet != null &&
      docNet != null &&
      Math.abs(docNet - params.amountNet) < 0.01
    ) {
      match = true;
    }
    if (match) {
      candidates.push({
        id: doc.id,
        number: docNumber || null,
        entityName: strOrEmpty(d.entityName as string) || null,
        amountNet: docNet,
        date: strOrEmpty(d.date as string) || null,
      });
    }
    if (candidates.length >= 5) break;
  }
  return candidates;
}

export async function findSuggestedJobs(
  db: Firestore,
  companyId: string,
  params: {
    entityName: string;
    noteText: string;
    itemsText: string;
  }
): Promise<DocumentAiSuggestedJob[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .limit(80)
    .get();

  const hay = `${params.entityName} ${params.noteText} ${params.itemsText}`.toLowerCase();
  const scored: DocumentAiSuggestedJob[] = [];

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const name = strOrEmpty(d.name as string);
    const customer = strOrEmpty(d.customerName as string);
    const address = strOrEmpty(d.address as string);
    let score = 0;
    if (name && hay.includes(name.toLowerCase())) score += 40;
    if (customer && hay.includes(customer.toLowerCase())) score += 25;
    if (address && address.length > 5 && hay.includes(address.toLowerCase().slice(0, 12))) {
      score += 15;
    }
    if (score >= 25) {
      scored.push({
        id: doc.id,
        name: name || doc.id,
        customerName: customer || null,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

export async function findSupplierByIcoOrName(
  db: Firestore,
  companyId: string,
  params: { ico: string | null; name: string | null }
): Promise<{ found: boolean; name: string | null; ico: string | null }> {
  const ico = strOrEmpty(params.ico).replace(/\D/g, "").slice(0, 8);
  const name = strOrEmpty(params.name).toLowerCase();

  const contactsSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("documentEmailContacts")
    .limit(100)
    .get();

  for (const c of contactsSnap.docs) {
    const d = c.data() as Record<string, unknown>;
    const cName = strOrEmpty(d.name as string).toLowerCase();
    if (name && cName && (cName.includes(name) || name.includes(cName))) {
      return { found: true, name: strOrEmpty(d.name as string), ico: null };
    }
  }

  return { found: false, name: params.name, ico: ico || null };
}

export async function validateDocumentAiExtraction(
  db: Firestore,
  companyId: string,
  rawOutput: unknown,
  meta: { model: string; requestDurationMs: number }
): Promise<DocumentAiValidatedResult> {
  const raw = parseDocumentAiExtraction(rawOutput);
  const warnings = [...raw.warnings.map((w) => w.trim()).filter(Boolean)];

  if (!raw.documentReadable) {
    return {
      readable: false,
      unreadableReason:
        strOrEmpty(raw.unreadableReason) ||
        "Doklad se nepodařilo spolehlivě přečíst.",
      raw,
      warnings,
      confidence: 0,
      fieldConfidences: raw.fieldConfidences,
      suggestedCategory: null,
      direction: "received",
      formPatch: {
        number: "",
        entityName: "",
        amount: "",
        currency: "CZK",
        vat: "21",
        date: new Date().toISOString().slice(0, 10),
        description: "",
        costCategory: "other",
        dueDate: "",
        requiresPayment: false,
        paymentMethod: "bank",
        paymentNote: "",
      },
      duplicateCandidates: [],
      suggestedJobs: [],
      supplierMatch: { found: false, name: null, ico: null },
      model: meta.model,
      requestDurationMs: meta.requestDurationMs,
    };
  }

  validateAmounts(raw, warnings);

  const direction = resolveDirection(raw);
  const formPatch = buildFormPatch(raw, direction);
  const category = mapCategory(raw.suggestedCategory);
  if (category) formPatch.costCategory = category;

  const amountNet =
    formPatch.amount.trim() === ""
      ? null
      : Number(String(formPatch.amount).replace(",", "."));

  const [duplicateCandidates, suggestedJobs, supplierMatch] = await Promise.all([
    findDuplicateDocuments(db, companyId, {
      documentNumber: formPatch.number,
      entityName: formPatch.entityName,
      amountNet: Number.isFinite(amountNet!) ? amountNet : null,
    }),
    findSuggestedJobs(db, companyId, {
      entityName: formPatch.entityName,
      noteText: buildDescription(raw),
      itemsText: raw.items.map((i) => strOrEmpty(i.description)).join(" "),
    }),
    findSupplierByIcoOrName(db, companyId, {
      ico: raw.supplier.ico,
      name: raw.supplier.name,
    }),
  ]);

  if (duplicateCandidates.length > 0) {
    warnings.push("Pozor, podobný doklad už v RajmonData existuje.");
  }
  if (!supplierMatch.found && strOrEmpty(raw.supplier.name)) {
    warnings.push("Dodavatel nebyl nalezen v CRM.");
  }

  const confidence = clamp01(raw.confidence);
  const fieldConfidences: DocumentAiFieldConfidences = {
    documentNumber: clamp01(raw.fieldConfidences.documentNumber),
    supplierName: clamp01(raw.fieldConfidences.supplierName),
    issueDate: clamp01(raw.fieldConfidences.issueDate),
    dueDate: clamp01(raw.fieldConfidences.dueDate),
    amountWithoutVat: clamp01(raw.fieldConfidences.amountWithoutVat),
    vatAmount: clamp01(raw.fieldConfidences.vatAmount),
    amountWithVat: clamp01(raw.fieldConfidences.amountWithVat),
    currency: clamp01(raw.fieldConfidences.currency),
    costCategory: clamp01(raw.fieldConfidences.costCategory),
  };

  return {
    readable: true,
    unreadableReason: null,
    raw,
    warnings,
    confidence,
    fieldConfidences,
    suggestedCategory: category,
    direction,
    formPatch,
    duplicateCandidates,
    suggestedJobs,
    supplierMatch,
    model: meta.model,
    requestDurationMs: meta.requestDurationMs,
  };
}

export function buildAiFilledFields(
  patch: DocumentAiFormPatch
): Partial<Record<keyof DocumentAiFormPatch, boolean>> {
  const filled: Partial<Record<keyof DocumentAiFormPatch, boolean>> = {};
  for (const key of Object.keys(patch) as Array<keyof DocumentAiFormPatch>) {
    const v = patch[key];
    if (typeof v === "string" && v.trim()) filled[key] = true;
    else if (typeof v === "boolean" && v) filled[key] = true;
  }
  return filled;
}

export function buildAiLowConfidenceFields(
  confidences: DocumentAiFieldConfidences
): Partial<Record<keyof DocumentAiFormPatch, boolean>> {
  const map: Partial<Record<keyof DocumentAiFormPatch, boolean>> = {};
  if (
    confidences.documentNumber != null &&
    confidences.documentNumber < LOW_CONFIDENCE_THRESHOLD
  ) {
    map.number = true;
  }
  if (
    confidences.supplierName != null &&
    confidences.supplierName < LOW_CONFIDENCE_THRESHOLD
  ) {
    map.entityName = true;
  }
  if (confidences.issueDate != null && confidences.issueDate < LOW_CONFIDENCE_THRESHOLD) {
    map.date = true;
  }
  if (confidences.dueDate != null && confidences.dueDate < LOW_CONFIDENCE_THRESHOLD) {
    map.dueDate = true;
  }
  if (
    confidences.amountWithoutVat != null &&
    confidences.amountWithoutVat < LOW_CONFIDENCE_THRESHOLD
  ) {
    map.amount = true;
  }
  if (confidences.costCategory != null && confidences.costCategory < LOW_CONFIDENCE_THRESHOLD) {
    map.costCategory = true;
  }
  return map;
}
