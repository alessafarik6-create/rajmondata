/**
 * Pravidla typů poptávek pro AI (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  AI_INQUIRY_TYPE_RULES_COLLECTION,
  AI_SETTINGS_DOC_ID,
  defaultAiAssistantSettings,
  defaultBuiltInInquiryTypeRules,
  type AiAssistantSettingsDoc,
  type AiInquiryTypeRuleDoc,
} from "@/lib/ai/ai-settings-types";

export function normalizeInquiryTypeLabel(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function inquiryTypeMatchesRule(
  inquiryType: string,
  rule: Pick<AiInquiryTypeRuleDoc, "matchPatterns">
): boolean {
  const normalized = normalizeInquiryTypeLabel(inquiryType);
  if (!normalized) {
    return rule.matchPatterns.includes("*");
  }
  for (const pattern of rule.matchPatterns) {
    const p = normalizeInquiryTypeLabel(pattern);
    if (!p || p === "*") return true;
    if (normalized.includes(p) || p.includes(normalized)) return true;
  }
  return false;
}

export function parseAiAssistantSettingsDoc(
  companyId: string,
  data: Record<string, unknown> | undefined
): AiAssistantSettingsDoc {
  const defaults = defaultAiAssistantSettings(companyId);
  if (!data) return defaults;
  const knowledgeRaw =
    data.knowledge && typeof data.knowledge === "object"
      ? (data.knowledge as Record<string, unknown>)
      : {};
  return {
    companyId,
    enabled: data.enabled !== false,
    baseInstructions: String(data.baseInstructions ?? defaults.baseInstructions).trim(),
    knowledge: {
      useHistoricalQuotes: knowledgeRaw.useHistoricalQuotes !== false,
      historicalQuotesLimit: clampInt(
        knowledgeRaw.historicalQuotesLimit,
        1,
        15,
        defaults.knowledge.historicalQuotesLimit
      ),
      preferSentQuotes: knowledgeRaw.preferSentQuotes !== false,
      preferApprovedAiGenerations: knowledgeRaw.preferApprovedAiGenerations !== false,
      preferWonJobs: knowledgeRaw.preferWonJobs !== false,
    },
  };
}

export function parseAiInquiryTypeRuleDoc(
  id: string,
  companyId: string,
  data: Record<string, unknown>
): AiInquiryTypeRuleDoc {
  return {
    id,
    companyId,
    name: String(data.name ?? "").trim() || "Typ poptávky",
    matchPatterns: stringArray(data.matchPatterns),
    systemInstructions: String(data.systemInstructions ?? "").trim(),
    requiredInformation: stringArray(data.requiredInformation),
    optionalInformation: stringArray(data.optionalInformation),
    ignoredInformation: stringArray(data.ignoredInformation),
    productCategoryHints: stringArray(data.productCategoryHints),
    quoteRules: String(data.quoteRules ?? "").trim(),
    active: data.active !== false,
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 100,
  };
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function loadAiAssistantSettings(
  db: Firestore,
  companyId: string
): Promise<AiAssistantSettingsDoc> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("ai_settings")
    .doc(AI_SETTINGS_DOC_ID)
    .get();
  return parseAiAssistantSettingsDoc(companyId, snap.data() as Record<string, unknown> | undefined);
}

export async function loadAiInquiryTypeRules(
  db: Firestore,
  companyId: string
): Promise<AiInquiryTypeRuleDoc[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_INQUIRY_TYPE_RULES_COLLECTION)
    .limit(80)
    .get();

  const fromDb = snap.docs
    .map((d) => parseAiInquiryTypeRuleDoc(d.id, companyId, d.data() as Record<string, unknown>))
    .filter((r) => r.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "cs"));

  if (fromDb.length > 0) return fromDb;
  return defaultBuiltInInquiryTypeRules(companyId);
}

export function resolveInquiryTypeRule(
  inquiryType: string,
  rules: AiInquiryTypeRuleDoc[]
): AiInquiryTypeRuleDoc {
  const active = rules.filter((r) => r.active);
  for (const rule of active) {
    if (rule.name === "Obecná poptávka") continue;
    if (inquiryTypeMatchesRule(inquiryType, rule)) return rule;
  }
  const general =
    active.find((r) => r.name === "Obecná poptávka") ??
    active.find((r) => r.matchPatterns.includes("*"));
  if (general) return general;
  return defaultBuiltInInquiryTypeRules("")[2];
}

export function filterProductsByTypeRule<
  T extends {
    catalogName: string;
    name: string;
    category?: string;
  }
>(products: T[], rule: AiInquiryTypeRuleDoc): T[] {
  const hints = rule.productCategoryHints
    .map((h) => normalizeInquiryTypeLabel(h))
    .filter(Boolean);
  if (hints.length === 0) return products;
  const matched = products.filter((p) => {
    const hay = normalizeInquiryTypeLabel(
      [p.catalogName, p.name, p.category ?? ""].join(" ")
    );
    return hints.some((h) => hay.includes(h));
  });
  return matched.length > 0 ? matched : products;
}

export function isIgnoredMissingInformation(
  missingItem: string,
  ignoredInformation: string[]
): boolean {
  const item = normalizeInquiryTypeLabel(missingItem);
  if (!item) return false;
  for (const ignored of ignoredInformation) {
    if (ignoredPhraseMatchesMissing(ignored, item)) return true;
  }
  return false;
}

function ignoredPhraseMatchesMissing(ignoredPhrase: string, normalizedMissing: string): boolean {
  const ig = normalizeInquiryTypeLabel(ignoredPhrase);
  if (!ig) return false;
  if (normalizedMissing.includes(ig) || ig.includes(normalizedMissing)) return true;
  const words = ig.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  return words.every((word) => {
    const stem = word.length > 5 ? word.slice(0, 5) : word;
    return normalizedMissing.includes(stem);
  });
}

export function filterIgnoredMissingInformation(
  missing: string[],
  ignoredInformation: string[]
): string[] {
  if (ignoredInformation.length === 0) return missing;
  return missing.filter((m) => !isIgnoredMissingInformation(m, ignoredInformation));
}
