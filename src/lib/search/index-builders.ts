/**
 * Sestavení search index záznamů z entit CRM.
 */

import type { SearchEntityType, SearchIndexDoc, SearchIndexMetadata } from "@/lib/search/types";
import { normalizeExactKey, normalizeSearchText, tokenizeSearchText } from "@/lib/search/normalize";
import { searchIndexDocId } from "@/lib/search/types";

function tsToMs(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const d = Date.parse(value);
    return Number.isFinite(d) ? d : Date.now();
  }
  if (typeof value === "object") {
    const row = value as { toMillis?: () => number; seconds?: number };
    if (typeof row.toMillis === "function") return row.toMillis();
    if (typeof row.seconds === "number") return row.seconds * 1000;
  }
  return Date.now();
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.map((p) => str(p)).filter(Boolean).join("\n");
}

function buildExactKeys(values: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const v of values) {
    const s = str(v);
    if (!s) continue;
    keys.add(normalizeExactKey(s));
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 4) keys.add(digits);
  }
  return [...keys].slice(0, 40);
}

function baseEntry(
  companyId: string,
  entityType: SearchEntityType,
  entityId: string,
  title: string,
  subtitle: string | null,
  searchText: string,
  metadata: SearchIndexMetadata,
  openUrl: string,
  extraExact: string[] = [],
  opts?: { mimeType?: string | null; fileUrl?: string | null; createdAt?: unknown; updatedAt?: unknown }
): SearchIndexDoc {
  const normalized = normalizeSearchText(searchText);
  const keywords = tokenizeSearchText(searchText);
  const exactKeys = buildExactKeys([
    title,
    subtitle,
    metadata.documentNumber,
    metadata.invoiceNumber,
    metadata.variableSymbol,
    metadata.supplierIco,
    metadata.email,
    metadata.phone,
    metadata.jobId,
    entityId,
    ...extraExact,
  ]);

  return {
    companyId,
    entityType,
    entityId,
    title: title || entityId,
    subtitle,
    searchText: normalized,
    keywords,
    exactKeys,
    metadata,
    openUrl,
    mimeType: opts?.mimeType ?? null,
    fileUrl: opts?.fileUrl ?? null,
    visibleToRoles: ["owner", "admin", "manager", "accountant", "employee"],
    moduleKey: entityType === "document" || entityType === "invoice" ? "invoicing" : null,
    createdAtMs: tsToMs(opts?.createdAt),
    updatedAtMs: tsToMs(opts?.updatedAt ?? opts?.createdAt),
  };
}

export function buildDocumentSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  if (data.isDeleted === true) return null;

  const documentNumber =
    str(data.number) ||
    str(data.documentNumber) ||
    str(data.nazev) ||
    str(data.invoiceNumber);
  const supplier =
    str(data.supplierName) ||
    str(data.entityName) ||
    str(data.dodavatel) ||
    str(data.counterpartyName);
  const customer = str(data.customerName);
  const jobId = str(data.assignedTo && typeof data.assignedTo === "object"
    ? (data.assignedTo as { jobId?: string }).jobId
    : data.jobId);
  const jobName = str(data.jobName);
  const note = str(data.note ?? data.poznamka ?? data.description);
  const fileName = str(data.fileName);
  const aiSearchText = str(data.aiSearchText ?? data.ocrText);
  const itemsText = Array.isArray(data.lineItems)
    ? (data.lineItems as Array<Record<string, unknown>>)
        .map((i) => joinParts([str(i.name), str(i.description), str(i.text)]))
        .join("\n")
    : "";

  const amounts = docAmounts(data);
  const title = documentNumber || fileName || id;
  const subtitle = joinParts([supplier, customer, jobName]).split("\n").filter(Boolean).slice(0, 2).join(" · ") || null;

  const searchText = joinParts([
    title,
    supplier,
    customer,
    jobName,
    note,
    fileName,
    aiSearchText,
    itemsText,
    str(data.variableSymbol),
    str(data.costCategory),
  ]);

  const metadata: SearchIndexMetadata = {
    documentNumber: documentNumber || null,
    invoiceNumber: str(data.invoiceNumber) || null,
    variableSymbol: str(data.variableSymbol) || null,
    supplier: supplier || null,
    supplierIco: str(data.supplierIco ?? data.ico) || null,
    customer: customer || null,
    jobId: jobId || null,
    jobName: jobName || null,
    customerId: str(data.customerId) || null,
    amountNet: amounts.net,
    amountGross: amounts.gross,
    currency: str(data.currency) || "CZK",
    issueDate: str(data.date) || null,
    dueDate: str(data.dueDate) || null,
    category: str(data.costCategory ?? data.documentType) || null,
    status: str(data.paymentStatus ?? data.paid) || null,
    fileName: fileName || null,
  };

  const mime = str(data.mimeType ?? data.fileType) || null;
  const isPdf = mime?.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
  const isImage = mime?.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(fileName);

  return baseEntry(
    companyId,
    isPdf ? "document" : isImage && fileName ? "file" : "document",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/documents?highlight=${encodeURIComponent(id)}`,
    [str(data.sourceInvoiceId), str(data.invoiceId)],
    {
      mimeType: mime,
      fileUrl: str(data.fileUrl) || null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt ?? data.createdAt,
    }
  );
}

function docAmounts(data: Record<string, unknown>): { net: number | null; gross: number | null } {
  const gross = num(data.amountGross ?? data.castka ?? data.amount ?? data.castkaCZK ?? data.amountGrossCZK);
  const net = num(data.amountNet ?? data.amountNetCZK);
  return { net, gross };
}

export function buildInvoiceSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  const invoiceNumber = str(data.invoiceNumber ?? data.documentNumber);
  const customer = str(data.customerName ?? data.buyerName);
  const jobId = str(data.jobId);
  const jobName = str(data.jobName ?? data.jobTitle);
  const note = str(data.note ?? data.description);
  const itemsText = Array.isArray(data.items)
    ? (data.items as Array<Record<string, unknown>>)
        .map((i) => joinParts([str(i.name), str(i.description)]))
        .join("\n")
    : "";
  const htmlSnippet = str(data.pdfHtml).slice(0, 4000);

  const title = invoiceNumber || id;
  const subtitle = joinParts([customer, jobName]).split("\n").filter(Boolean).slice(0, 2).join(" · ") || null;
  const gross = num(data.totalGross ?? data.amountGross ?? data.total ?? data.castka);

  const searchText = joinParts([title, customer, jobName, note, itemsText, htmlSnippet]);

  const metadata: SearchIndexMetadata = {
    invoiceNumber: invoiceNumber || null,
    documentNumber: invoiceNumber || null,
    customer: customer || null,
    jobId: jobId || null,
    jobName: jobName || null,
    amountGross: gross,
    currency: str(data.currency) || "CZK",
    issueDate: str(data.issueDate ?? data.date) || null,
    dueDate: str(data.dueDate) || null,
    status: str(data.status) || null,
  };

  return baseEntry(
    companyId,
    "invoice",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/invoices/${encodeURIComponent(id)}`,
    [str(data.variableSymbol), str(data.jobNumber)],
    { createdAt: data.createdAt, updatedAt: data.updatedAt ?? data.createdAt }
  );
}

export function buildOfferSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  const offerNumber = str(data.offerNumber ?? data.number ?? data.id);
  const subject = str(data.subject ?? data.title ?? data.inquiryType);
  const customer = str(data.customerName ?? data.contactName);
  const note = str(data.note ?? data.message ?? data.bodyText);
  const itemsText = Array.isArray(data.items)
    ? (data.items as Array<Record<string, unknown>>)
        .map((i) => joinParts([str(i.name), str(i.description)]))
        .join("\n")
    : str(data.itemsSummary);

  const title = offerNumber || subject || id;
  const subtitle = joinParts([subject, customer]).split("\n").filter(Boolean).slice(0, 2).join(" · ") || null;
  const gross = num(data.totalGross ?? data.totalPrice ?? data.amount);

  const searchText = joinParts([title, subject, customer, note, itemsText, str(data.inquiryType)]);

  const metadata: SearchIndexMetadata = {
    documentNumber: offerNumber || null,
    customer: customer || null,
    amountGross: gross,
    currency: "CZK",
    inquiryType: str(data.inquiryType) || null,
    status: str(data.status) || null,
    issueDate: str(data.sentAt ?? data.createdAt) || null,
  };

  return baseEntry(
    companyId,
    "offer",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/offers?highlight=${encodeURIComponent(id)}`,
    [str(data.leadId)],
    { createdAt: data.createdAt, updatedAt: data.updatedAt ?? data.sentAt }
  );
}

export function buildInquirySearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  const name = str(data.contactName ?? data.name ?? data.customerName);
  const email = str(data.email);
  const phone = str(data.phone);
  const inquiryType = str(data.inquiryType ?? data.type);
  const message = str(data.message ?? data.note ?? data.description ?? data.rawText);
  const tags = Array.isArray(data.tags) ? (data.tags as string[]).join(" ") : "";

  const title = name || inquiryType || id;
  const subtitle = joinParts([inquiryType, email]).split("\n").filter(Boolean).slice(0, 2).join(" · ") || null;
  const searchText = joinParts([title, email, phone, inquiryType, message, tags]);

  const metadata: SearchIndexMetadata = {
    customer: name || null,
    email: email || null,
    phone: phone || null,
    inquiryType: inquiryType || null,
    status: str(data.workflowStatus ?? data.status) || null,
    issueDate: str(data.receivedAt) || null,
  };

  return baseEntry(
    companyId,
    "inquiry",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/leads?highlight=${encodeURIComponent(id)}`,
    [],
    { createdAt: data.receivedAt ?? data.createdAt, updatedAt: data.updatedAt }
  );
}

export function buildJobSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  const name = str(data.name);
  const jobNumber = str(data.jobNumber ?? data.orderNumber ?? data.documentNumber ?? data.jobTag);
  const customer = str(data.customerName);
  const description = str(data.description ?? data.note);
  const address = str(data.address ?? data.installationAddress);

  const title = jobNumber || name || id;
  const subtitle = joinParts([name, customer]).split("\n").filter(Boolean).slice(0, 2).join(" · ") || null;
  const searchText = joinParts([title, name, jobNumber, customer, description, address]);

  const metadata: SearchIndexMetadata = {
    documentNumber: jobNumber || null,
    customer: customer || null,
    customerId: str(data.customerId) || null,
    jobId: id,
    jobName: name || null,
    status: str(data.status) || null,
    issueDate: str(data.startDate) || null,
  };

  return baseEntry(
    companyId,
    "job",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/jobs/${encodeURIComponent(id)}`,
    [jobNumber],
    { createdAt: data.createdAt, updatedAt: data.updatedAt }
  );
}

export function buildCustomerSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  const name = str(data.name ?? data.companyName ?? data.displayName);
  const email = str(data.email);
  const phone = str(data.phone);
  const ico = str(data.ico);
  const dic = str(data.dic ?? data.DIC);
  const address = str(data.address ?? data.street);
  const note = str(data.note);

  const title = name || email || id;
  const subtitle = joinParts([email, phone]).split("\n").filter(Boolean).slice(0, 2).join(" · ") || null;
  const searchText = joinParts([title, name, email, phone, ico, dic, address, note]);

  const metadata: SearchIndexMetadata = {
    customer: name || null,
    customerIco: ico || null,
    email: email || null,
    phone: phone || null,
    customerId: id,
  };

  return baseEntry(
    companyId,
    "customer",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/customers/${encodeURIComponent(id)}`,
    [ico, dic, email, phone],
    { createdAt: data.createdAt, updatedAt: data.updatedAt }
  );
}

export function buildProductSearchIndex(
  companyId: string,
  id: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  const name = str(data.name ?? data.title);
  const code = str(data.code ?? data.sku);
  const description = str(data.description);
  const category = str(data.category);

  const title = name || code || id;
  const subtitle = category || null;
  const searchText = joinParts([title, code, description, category]);
  const price = num(data.price ?? data.unitPrice);

  const metadata: SearchIndexMetadata = {
    documentNumber: code || null,
    category: category || null,
    amountGross: price,
    currency: "CZK",
  };

  return baseEntry(
    companyId,
    "product",
    id,
    title,
    subtitle,
    searchText,
    metadata,
    `/portal/catalogs?highlight=${encodeURIComponent(id)}`,
    [code],
    { createdAt: data.createdAt, updatedAt: data.updatedAt }
  );
}

export function buildSearchIndexFromEntity(
  companyId: string,
  entityType: SearchEntityType,
  entityId: string,
  data: Record<string, unknown>
): SearchIndexDoc | null {
  switch (entityType) {
    case "document":
    case "file":
      return buildDocumentSearchIndex(companyId, entityId, data);
    case "invoice":
      return buildInvoiceSearchIndex(companyId, entityId, data);
    case "offer":
      return buildOfferSearchIndex(companyId, entityId, data);
    case "inquiry":
      return buildInquirySearchIndex(companyId, entityId, data);
    case "job":
      return buildJobSearchIndex(companyId, entityId, data);
    case "customer":
      return buildCustomerSearchIndex(companyId, entityId, data);
    case "product":
      return buildProductSearchIndex(companyId, entityId, data);
    default:
      return null;
  }
}

export const ENTITY_COLLECTION_MAP: Record<
  SearchEntityType,
  string | null
> = {
  document: "documents",
  file: "documents",
  invoice: "invoices",
  offer: "inquiry_offers",
  inquiry: "import_lead_overlays",
  job: "jobs",
  customer: "customers",
  product: "product_catalogs",
};

export const BACKFILL_ENTITY_TYPES: SearchEntityType[] = [
  "document",
  "invoice",
  "offer",
  "inquiry",
  "job",
  "customer",
  "product",
];
