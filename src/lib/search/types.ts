/**
 * Typy pro centrální CRM vyhledávání.
 */

export const SEARCH_INDEX_COLLECTION = "search_index";

export type SearchEntityType =
  | "document"
  | "invoice"
  | "offer"
  | "inquiry"
  | "job"
  | "customer"
  | "product"
  | "file";

export type SearchMatchReason =
  | "exact_number"
  | "exact_ico"
  | "exact_email"
  | "exact_phone"
  | "exact_id"
  | "full_text"
  | "semantic"
  | "filter";

export type SearchIndexDoc = {
  companyId: string;
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  searchText: string;
  keywords: string[];
  exactKeys: string[];
  metadata: SearchIndexMetadata;
  openUrl: string;
  mimeType?: string | null;
  fileUrl?: string | null;
  embedding?: number[] | null;
  embeddingHash?: string | null;
  visibleToRoles: string[];
  moduleKey?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type SearchIndexMetadata = {
  documentNumber?: string | null;
  invoiceNumber?: string | null;
  variableSymbol?: string | null;
  supplier?: string | null;
  supplierIco?: string | null;
  customer?: string | null;
  customerIco?: string | null;
  email?: string | null;
  phone?: string | null;
  jobId?: string | null;
  jobName?: string | null;
  customerId?: string | null;
  amountNet?: number | null;
  amountGross?: number | null;
  currency?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  category?: string | null;
  inquiryType?: string | null;
  status?: string | null;
  fileName?: string | null;
};

export type SearchIntent = {
  rawQuery: string;
  entityTypes: SearchEntityType[] | null;
  supplier: string | null;
  customer: string | null;
  jobQuery: string | null;
  documentNumber: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  semanticQuery: string | null;
  useAiParser: boolean;
};

export type SearchResultItem = {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  detail: string | null;
  openUrl: string;
  matchReason: SearchMatchReason;
  matchDetail: string;
  score: number;
  metadata: SearchIndexMetadata;
  mimeType?: string | null;
  fileUrl?: string | null;
};

export type SearchResponse = {
  query: string;
  intent: Partial<SearchIntent>;
  results: SearchResultItem[];
  grouped: Record<string, SearchResultItem[]>;
  tookMs: number;
  usedSemantic: boolean;
  usedAiParser: boolean;
};

export function searchIndexDocId(entityType: SearchEntityType, entityId: string): string {
  return `${entityType}_${entityId}`;
}

export const SEARCH_ENTITY_LABELS: Record<SearchEntityType, string> = {
  document: "Doklad",
  invoice: "Faktura",
  offer: "Nabídka",
  inquiry: "Poptávka",
  job: "Zakázka",
  customer: "Zákazník",
  product: "Produkt",
  file: "Soubor",
};

export function searchEntityLabel(entityType: SearchEntityType | string): string {
  return SEARCH_ENTITY_LABELS[entityType as SearchEntityType] ?? entityType;
}
