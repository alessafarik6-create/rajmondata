/**
 * Typy a konstanty pro AI centrum (cenová pravidla, znalostní báze, vzory nabídek).
 */

export const AI_PRICE_RULES_COLLECTION = "ai_price_rules";
export const AI_KNOWLEDGE_DOCUMENTS_COLLECTION = "ai_knowledge_documents";
export const AI_KNOWLEDGE_CHUNKS_COLLECTION = "chunks";
export const AI_QUOTE_EXAMPLES_COLLECTION = "ai_quote_examples";

export type AiPriceCalculationType =
  | "per_m2"
  | "per_bm"
  | "per_piece"
  | "fixed"
  | "percentage_markup"
  | "percentage_discount"
  | "min_price"
  | "max_discount";

export const AI_PRICE_CALCULATION_LABELS: Record<AiPriceCalculationType, string> = {
  per_m2: "Kč / m²",
  per_bm: "Kč / bm",
  per_piece: "Kč / ks",
  fixed: "Pevná částka",
  percentage_markup: "Přírážka %",
  percentage_discount: "Sleva %",
  min_price: "Minimální cena",
  max_discount: "Maximální sleva %",
};

export type AiPriceRuleDoc = {
  id?: string;
  companyId: string;
  name: string;
  /** Název typu poptávky (pravidlo ai_inquiry_type_rules) nebo volný text. */
  inquiryType?: string | null;
  productCategory?: string | null;
  calculationType: AiPriceCalculationType;
  value: number;
  currency: string;
  /** Propojení s produktem v katalogu — má prioritu před volným párováním. */
  catalogId?: string | null;
  productId?: string | null;
  /** Podřetězec v názvu produktu nebo textu poptávky (case-insensitive). */
  productNamePattern?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  priority: number;
  active: boolean;
  description?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedByUid?: string | null;
};

export type AiKnowledgeCategory =
  | "pricing"
  | "products"
  | "technical"
  | "business_rules"
  | "installation"
  | "contracts"
  | "general";

export const AI_KNOWLEDGE_CATEGORY_LABELS: Record<AiKnowledgeCategory, string> = {
  pricing: "Ceník",
  products: "Produkty",
  technical: "Technické informace",
  business_rules: "Obchodní pravidla",
  installation: "Montáž",
  contracts: "Smlouvy",
  general: "Obecné",
};

export type AiKnowledgeDocumentStatus =
  | "uploading"
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type AiKnowledgeDocumentDoc = {
  id?: string;
  companyId: string;
  title: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  downloadUrl?: string | null;
  fileSizeBytes?: number | null;
  category: AiKnowledgeCategory;
  active: boolean;
  status: AiKnowledgeDocumentStatus;
  chunkCount: number;
  errorMessage?: string | null;
  uploadedByUid?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AiKnowledgeChunkDoc = {
  id?: string;
  companyId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding?: number[] | null;
  embeddingModel?: string | null;
  tokenEstimate?: number | null;
  createdAt?: unknown;
};

export type AiQuoteExampleSource = "crm_offer" | "manual" | "upload";

export type AiQuoteExampleDoc = {
  id?: string;
  companyId: string;
  source: AiQuoteExampleSource;
  inquiryType: string;
  title: string;
  dimensionsText?: string | null;
  bodyText?: string | null;
  itemsSummary?: string | null;
  /** Historická cena — pouze pro referenci, ne pro výpočet. */
  referencePriceNet?: number | null;
  offerId?: string | null;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedByUid?: string | null;
};

export type AiInstructionCategories = {
  quotes: string;
  documents: string;
  communication: string;
};

export function defaultAiInstructionCategories(): AiInstructionCategories {
  return {
    quotes:
      "Nevymýšlej ceny — cenu vždy určí CRM z cenových pravidel a katalogu. Strukturu nabídky odvozuj z podobných schválených nabídek.",
    documents: "Při práci s dokumenty vycházej z firemních podkladů a technických listů.",
    communication:
      "Komunikuj profesionálně a stručně. Pokud údaj chybí, nepředpokládej ho — uveď ho do chybějících informací.",
  };
}

export type AiPriceExplainabilityLine = {
  ruleId: string;
  ruleName: string;
  calculationType: AiPriceCalculationType;
  expression: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineNet: number;
  source: "catalog" | "price_rule";
};

export type AiPriceExplainability = {
  dimensions: {
    widthMm: number | null;
    depthMm: number | null;
    areaM2: number | null;
    distanceKm: number | null;
  };
  appliedLines: AiPriceExplainabilityLine[];
  knowledgeSources: string[];
  exampleSources: string[];
};
