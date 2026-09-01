/**
 * Sestavení CRM kontextu pro AI návrh nabídky (server-only, Admin SDK).
 */

import type { Firestore } from "firebase-admin/firestore";
import type { ProductCatalogProduct } from "@/lib/product-catalogs";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { AiAssistantSettingsDoc, AiInquiryTypeRuleDoc } from "@/lib/ai/ai-settings-types";
import {
  filterProductsByTypeRule,
  loadAiAssistantSettings,
  loadAiInquiryTypeRules,
  resolveInquiryTypeRule,
} from "@/lib/ai/inquiry-type-rules";
import {
  findSimilarHistoricalQuotes,
  type SimilarQuoteExample,
} from "@/lib/ai/similar-quotes-retriever";

export type AiCrmProductRef = {
  catalogId: string;
  catalogName: string;
  productId: string;
  name: string;
  shortDescription?: string;
  category?: string;
  price: number | null;
  note?: string;
};

export type AiCrmCustomerHistory = {
  customerId: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  recentJobs: Array<{ id: string; name: string; status?: string }>;
};

export type AiCrmOfferHistoryItem = {
  id: string;
  status: string;
  subject: string;
  priceNet: number | null;
  priceGross: number | null;
  sentAtIso?: string | null;
};

export type AiInquiryCrmContext = {
  companyId: string;
  companyName: string;
  leadKey: string;
  importLeadId?: string | null;
  inquiry: {
    name: string;
    email: string;
    phone: string;
    address: string;
    message: string;
    type: string;
    estimatedPriceKc: number | null;
    receivedAtIso?: string | null;
    workflowStatus?: string | null;
    internalNote?: string | null;
  };
  customer: AiCrmCustomerHistory | null;
  offerHistory: AiCrmOfferHistoryItem[];
  products: AiCrmProductRef[];
  aiSettings: AiAssistantSettingsDoc;
  typeRule: AiInquiryTypeRuleDoc;
  relevantProducts: AiCrmProductRef[];
  similarQuotes: SimilarQuoteExample[];
};

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

function customerDisplayName(data: Record<string, unknown>): string {
  const company = String(data.companyName ?? "").trim();
  if (company) return company;
  const full = `${String(data.firstName ?? "").trim()} ${String(data.lastName ?? "").trim()}`.trim();
  return full || "Zákazník";
}

function toIso(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    return (raw as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export async function buildInquiryAiCrmContext(
  db: Firestore,
  companyId: string,
  leadKey: string
): Promise<AiInquiryCrmContext> {
  const [companySnap, overlaySnap, aiSettings, typeRules] = await Promise.all([
    db.collection(COMPANIES_COLLECTION).doc(companyId).get(),
    db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("import_lead_overlays")
      .doc(leadKey)
      .get(),
    loadAiAssistantSettings(db, companyId),
    loadAiInquiryTypeRules(db, companyId),
  ]);

  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const companyName =
    String(company.companyName ?? company.name ?? "").trim() || "Organizace";

  if (!overlaySnap.exists) {
    throw new Error("Poptávka nebyla nalezena v CRM.");
  }

  const ov = (overlaySnap.data() ?? {}) as Record<string, unknown>;
  const inquiryEmail = normalizeEmail(ov.email);
  const inquiry = {
    name: String(ov.jmeno ?? "").trim(),
    email: String(ov.email ?? "").trim(),
    phone: String(ov.telefon ?? "").trim(),
    address: String(ov.adresa ?? "").trim(),
    message: String(ov.zprava ?? "").trim(),
    type: String(ov.typ ?? ov.typ_poptavky ?? "").trim(),
    estimatedPriceKc:
      ov.orientacniCenaKc != null && Number.isFinite(Number(ov.orientacniCenaKc))
        ? Number(ov.orientacniCenaKc)
        : null,
    receivedAtIso: toIso(ov.receivedAtIso ?? ov.receivedAt ?? ov.datum_vytvoreni),
    workflowStatus: String(ov.workflowStatus ?? "").trim() || null,
    internalNote: String(ov.internalNote ?? "").trim() || null,
  };

  if (!inquiry.name && !inquiry.email && !inquiry.message) {
    throw new Error("Poptávka nemá dostatek dat pro AI analýzu.");
  }

  const typeRule = resolveInquiryTypeRule(inquiry.type || "Obecná poptávka", typeRules);

  let customer: AiCrmCustomerHistory | null = null;
  if (inquiryEmail) {
    const customersSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .where("email", "==", inquiry.email.trim())
      .limit(1)
      .get();
    if (!customersSnap.empty) {
      const cDoc = customersSnap.docs[0];
      const cData = (cDoc.data() ?? {}) as Record<string, unknown>;
      const jobsSnap = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("jobs")
        .where("customerId", "==", cDoc.id)
        .limit(8)
        .get();
      customer = {
        customerId: cDoc.id,
        displayName: customerDisplayName(cData),
        email: String(cData.email ?? "").trim() || null,
        phone: String(cData.phone ?? "").trim() || null,
        address: String(cData.address ?? "").trim() || null,
        notes: String(cData.notes ?? "").trim() || null,
        recentJobs: jobsSnap.docs.map((j) => {
          const jd = j.data() as Record<string, unknown>;
          return {
            id: j.id,
            name: String(jd.name ?? j.id).trim(),
            status: String(jd.status ?? "").trim() || undefined,
          };
        }),
      };
    }
  }

  const offersSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("inquiry_offers")
    .where("leadKey", "==", leadKey)
    .limit(12)
    .get();

  const offerHistory: AiCrmOfferHistoryItem[] = offersSnap.docs.map((d) => {
    const o = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      status: String(o.status ?? "draft"),
      subject: String(o.subject ?? "").trim(),
      priceNet:
        o.priceNet != null && Number.isFinite(Number(o.priceNet))
          ? Number(o.priceNet)
          : null,
      priceGross:
        o.priceGross != null && Number.isFinite(Number(o.priceGross))
          ? Number(o.priceGross)
          : null,
      sentAtIso: toIso(o.sentAt),
    };
  });

  const catalogsSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("product_catalogs")
    .limit(40)
    .get();

  const products: AiCrmProductRef[] = [];
  for (const catDoc of catalogsSnap.docs) {
    const cat = catDoc.data() as Record<string, unknown>;
    const catalogName = String(cat.name ?? catDoc.id).trim();
    const list = Array.isArray(cat.products) ? cat.products : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as ProductCatalogProduct;
      if (p.archived === true || p.active === false) continue;
      const productId = String(p.id ?? "").trim();
      const name = String(p.name ?? "").trim();
      if (!productId || !name) continue;
      products.push({
        catalogId: catDoc.id,
        catalogName,
        productId,
        name,
        shortDescription: String(p.shortDescription ?? "").trim() || undefined,
        category: String(p.category ?? "").trim() || undefined,
        price:
          p.price != null && Number.isFinite(Number(p.price)) ? Number(p.price) : null,
        note: String(p.note ?? "").trim() || undefined,
      });
    }
  }

  const relevantProducts = filterProductsByTypeRule(products, typeRule);

  const similarQuotes = await findSimilarHistoricalQuotes(db, {
    companyId,
    leadKey,
    inquiryType: inquiry.type || typeRule.name,
    inquiryMessage: inquiry.message,
    estimatedPriceKc: inquiry.estimatedPriceKc,
    typeRule,
    knowledge: aiSettings.knowledge,
  });

  return {
    companyId,
    companyName,
    leadKey,
    importLeadId: String(ov.importLeadId ?? leadKey).trim() || leadKey,
    inquiry,
    customer,
    offerHistory,
    products,
    aiSettings,
    typeRule,
    relevantProducts,
    similarQuotes,
  };
}

export function summarizeAiCrmContext(ctx: AiInquiryCrmContext): Record<string, unknown> {
  return {
    leadKey: ctx.leadKey,
    inquiryType: ctx.inquiry.type || ctx.typeRule.name,
    typeRuleName: ctx.typeRule.name,
    hasCustomerMatch: !!ctx.customer,
    productCount: ctx.products.length,
    relevantProductCount: ctx.relevantProducts.length,
    similarQuotesCount: ctx.similarQuotes.length,
    offerHistoryCount: ctx.offerHistory.length,
  };
}
