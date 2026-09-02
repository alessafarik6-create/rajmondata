/**
 * Vyhledání podobných historických nabídek pro AI kontext (server-only).
 * V1: relační skórování podle typu, ceny a textu. Připraveno na pozdější embeddings.
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { AI_GENERATIONS_COLLECTION } from "@/lib/ai/config";
import {
  normalizeInquiryTypeLabel,
  inquiryTypeMatchesRule,
} from "@/lib/ai/inquiry-type-rules";
import type { AiInquiryTypeRuleDoc, AiKnowledgeSourceSettings } from "@/lib/ai/ai-settings-types";

export type SimilarQuoteExample = {
  id: string;
  source: "sent_offer" | "approved_ai";
  inquiryType: string;
  status: string;
  subject: string;
  bodyExcerpt: string;
  priceNetKc: number | null;
  priceGrossKc: number | null;
  sentAtIso: string | null;
  relevanceScore: number;
  itemsSummary: string | null;
  /** Pro budoucí vector search — stabilní text pro embedding. */
  embeddingText: string;
};

type ScoredCandidate = SimilarQuoteExample & { _score: number };

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

function excerpt(text: string, max = 480): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function priceSimilarity(
  target: number | null,
  candidate: number | null
): number {
  if (target == null || candidate == null || target <= 0 || candidate <= 0) return 0;
  const ratio = Math.abs(target - candidate) / target;
  if (ratio <= 0.1) return 20;
  if (ratio <= 0.25) return 12;
  if (ratio <= 0.4) return 6;
  return 0;
}

function textOverlapScore(inquiryMessage: string, haystack: string): number {
  const msg = normalizeInquiryTypeLabel(inquiryMessage);
  const hay = normalizeInquiryTypeLabel(haystack);
  if (!msg || !hay) return 0;
  const tokens = msg.split(/\s+/).filter((t) => t.length >= 4);
  let hits = 0;
  for (const token of tokens) {
    if (hay.includes(token)) hits += 1;
  }
  return Math.min(15, hits * 3);
}

function typeMatchScore(
  candidateType: string,
  inquiryType: string,
  rule: AiInquiryTypeRuleDoc
): number {
  const a = normalizeInquiryTypeLabel(candidateType);
  const b = normalizeInquiryTypeLabel(inquiryType);
  if (!a || !b) return 0;
  if (a === b) return 50;
  if (a.includes(b) || b.includes(a)) return 40;
  if (inquiryTypeMatchesRule(candidateType, rule)) return 35;
  return 0;
}

async function loadOverlayTypes(
  db: Firestore,
  companyId: string,
  leadKeys: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(leadKeys.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20);
    const snaps = await Promise.all(
      batch.map((key) =>
        db
          .collection(COMPANIES_COLLECTION)
          .doc(companyId)
          .collection("import_lead_overlays")
          .doc(key)
          .get()
      )
    );
    for (let j = 0; j < batch.length; j += 1) {
      const data = snaps[j].data() as Record<string, unknown> | undefined;
      const typ = String(data?.typ ?? data?.typ_poptavky ?? "").trim();
      map.set(batch[j], typ);
    }
  }
  return map;
}

export async function findSimilarHistoricalQuotes(
  db: Firestore,
  params: {
    companyId: string;
    leadKey: string;
    inquiryType: string;
    inquiryMessage: string;
    estimatedPriceKc: number | null;
    typeRule: AiInquiryTypeRuleDoc;
    knowledge: AiKnowledgeSourceSettings;
  }
): Promise<SimilarQuoteExample[]> {
  if (!params.knowledge.useHistoricalQuotes) return [];

  const limit = params.knowledge.historicalQuotesLimit;
  const candidates: ScoredCandidate[] = [];

  const offersSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("inquiry_offers")
    .limit(120)
    .get();

  const offerDocs = offersSnap.docs.filter((d) => {
    const o = d.data() as Record<string, unknown>;
    const lk = String(o.leadKey ?? "");
    if (!lk || lk === "__standalone__") return false;
    if (lk === params.leadKey) return false;
    // Pouze nabídky explicitně označené jako AI vzor.
    if (o.useForAiExample !== true) return false;
    return true;
  });

  const overlayTypes = await loadOverlayTypes(
    db,
    params.companyId,
    offerDocs.map((d) => String((d.data() as Record<string, unknown>).leadKey ?? ""))
  );

  for (const doc of offerDocs) {
    const o = doc.data() as Record<string, unknown>;
    const leadKey = String(o.leadKey ?? "");
    const inquiryType =
      String(o.inquiryType ?? "").trim() || overlayTypes.get(leadKey) || "";
    const bodyPlain = String(o.bodyPlain ?? "").trim();
    const subject = String(o.subject ?? "").trim();
    const priceNet =
      o.priceNet != null && Number.isFinite(Number(o.priceNet))
        ? Number(o.priceNet)
        : null;
    const priceGross =
      o.priceGross != null && Number.isFinite(Number(o.priceGross))
        ? Number(o.priceGross)
        : null;
    const status = String(o.status ?? "draft");

    let score = typeMatchScore(inquiryType, params.inquiryType, params.typeRule);
    if (status === "sent") score += params.knowledge.preferSentQuotes ? 30 : 10;
    if (o.useForAiExample === true) score += 45;
    score += priceSimilarity(params.estimatedPriceKc, priceNet ?? priceGross);
    score += textOverlapScore(params.inquiryMessage, `${subject} ${bodyPlain}`);

    const sentAtIso = toIso(o.sentAt);
    if (sentAtIso) {
      const ageDays = (Date.now() - Date.parse(sentAtIso)) / 86_400_000;
      if (ageDays < 180) score += 5;
    }

    if (score < 25) continue;

    const bodyExcerpt = excerpt(bodyPlain || subject);
    candidates.push({
      id: doc.id,
      source: "sent_offer",
      inquiryType,
      status,
      subject: subject || doc.id,
      bodyExcerpt,
      priceNetKc: priceNet,
      priceGrossKc: priceGross,
      sentAtIso,
      relevanceScore: score,
      itemsSummary: null,
      embeddingText: [inquiryType, subject, bodyExcerpt].filter(Boolean).join("\n"),
      _score: score,
    });
  }

  if (params.knowledge.preferApprovedAiGenerations) {
    const genSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(params.companyId)
      .collection(AI_GENERATIONS_COLLECTION)
      .where("status", "==", "completed")
      .limit(60)
      .get();

    for (const doc of genSnap.docs) {
      const g = doc.data() as Record<string, unknown>;
      const lk = String(g.leadKey ?? "");
      if (!lk || lk === params.leadKey) continue;
      if (g.usedByUser !== true) continue;

      const summary = g.inputContextSummary as Record<string, unknown> | undefined;
      const inquiryType = String(summary?.inquiryType ?? "").trim();
      const validated = g.validatedOutput as Record<string, unknown> | undefined;
      const finalSnap = g.finalOfferSnapshot as Record<string, unknown> | undefined;
      const sentSnap = g.finalSentSnapshot as Record<string, unknown> | undefined;
      const snapshot = sentSnap ?? finalSnap ?? validated;

      const bodyText = String(snapshot?.bodyText ?? validated?.customerReply ?? "").trim();
      const priceNet =
        snapshot?.priceNet != null && Number.isFinite(Number(snapshot.priceNet))
          ? Number(snapshot.priceNet)
          : (validated?.pricing as { priceNet?: number } | undefined)?.priceNet ?? null;

      let score = typeMatchScore(inquiryType, params.inquiryType, params.typeRule);
      score += 25;
      if (g.offerSent === true) score += 20;
      score += priceSimilarity(params.estimatedPriceKc, priceNet);
      score += textOverlapScore(params.inquiryMessage, bodyText);

      const items = Array.isArray(validated?.recommendedItems)
        ? (validated.recommendedItems as Array<{ name?: string; quantity?: number; unit?: string }>)
        : [];
      const itemsSummary =
        items.length > 0
          ? items
              .slice(0, 6)
              .map((i) => `${i.name ?? "?"} (${i.quantity ?? "?"} ${i.unit ?? "ks"})`)
              .join("; ")
          : null;

      if (score < 30) continue;

      candidates.push({
        id: doc.id,
        source: "approved_ai",
        inquiryType,
        status: g.offerSent === true ? "sent" : "approved",
        subject: String(snapshot?.subject ?? "Schválený AI návrh").trim(),
        bodyExcerpt: excerpt(bodyText),
        priceNetKc: priceNet,
        priceGrossKc: null,
        sentAtIso: toIso(g.usedAt),
        relevanceScore: score,
        itemsSummary,
        embeddingText: [inquiryType, bodyText, itemsSummary ?? ""].filter(Boolean).join("\n"),
        _score: score,
      });
    }
  }

  candidates.sort((a, b) => b._score - a._score);
  const top = candidates.slice(0, limit).map(({ _score, ...rest }) => ({
    ...rest,
    relevanceScore: _score,
  }));
  return top;
}
