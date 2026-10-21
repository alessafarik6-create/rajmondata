import {
  PRODUCT_TOUR_KNOWLEDGE_MODULES,
  type ProductTourKnowledgeModule,
} from "@/lib/product-tour/knowledge-modules";

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9áčďéěíňóřšťúůýž]+/i)
    .filter((t) => t.length > 2);
}

export function retrieveProductTourKnowledge(
  query: string,
  limit = 5
): ProductTourKnowledgeModule[] {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return PRODUCT_TOUR_KNOWLEDGE_MODULES.slice(0, limit);

  const scored = PRODUCT_TOUR_KNOWLEDGE_MODULES.map((m) => {
    const hay = [
      m.name,
      m.description,
      m.howToUse,
      ...m.capabilities,
      ...m.keywords,
    ].join(" ");
    const tokens = tokenize(hay);
    let score = 0;
    for (const t of tokens) {
      if (qTokens.has(t)) score += 2;
    }
    for (const kw of m.keywords) {
      if (query.toLowerCase().includes(kw.toLowerCase())) score += 3;
    }
    return { m, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

export function formatKnowledgeContext(modules: ProductTourKnowledgeModule[]): string {
  return modules
    .map(
      (m) =>
        `[${m.name}] ${m.description} Pro koho: ${m.audience}. Použití: ${m.howToUse} Omezení: ${m.limitations} Ceny: ${m.pricingNote} Ověřeno: ${m.verifiedAt}.`
    )
    .join("\n");
}
