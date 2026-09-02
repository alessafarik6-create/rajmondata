/**
 * Deterministický parser vyhledávacích dotazů (CZ).
 * AI se volá až když tento parser nestačí.
 */

import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import type { SearchEntityType, SearchIntent } from "@/lib/search/types";
import {
  amountRangeFromApprox,
  digitsOnly,
  normalizeExactKey,
  normalizeSearchText,
  parseCzechAmountToken,
} from "@/lib/search/normalize";
import { isEntityListingIntent, meaningfulQueryTokens } from "@/lib/search/entity-listing";

const DOC_NUMBER_RE =
  /\b(FV|FA|NAB|DOD|DD|DL|OBJ|ZAK)[- ]?\d{4}[-/]?\d{2,6}\b/i;
const GENERIC_NUMBER_RE = /\b\d{4}[-/]\d{3,6}\b/;

const ENTITY_HINTS: Array<{ re: RegExp; types: SearchEntityType[] }> = [
  { re: /\bfaktur/, types: ["invoice", "document"] },
  { re: /\bdoklad/, types: ["document"] },
  { re: /\bucten/, types: ["document", "file"] },
  { re: /\bnab[ií]dk/, types: ["offer"] },
  { re: /\bpopt[aá]vk/, types: ["inquiry"] },
  { re: /\bzak[aá]zk/, types: ["job"] },
  { re: /\bz[aá]kazn[ií]k/, types: ["customer"] },
  { re: /\bdodavatel/, types: ["document"] },
  { re: /\bpdf\b/, types: ["document", "file"] },
  { re: /\bfot(o|ka|ografie)?\b/, types: ["file", "document"] },
  { re: /\bkatalog|\bprodukt/, types: ["product"] },
];

const MONTHS: Record<string, number> = {
  leden: 1,
  unor: 2,
  únor: 2,
  brezen: 3,
  březen: 3,
  duben: 4,
  kveten: 5,
  květen: 5,
  cerven: 6,
  červen: 6,
  cervenec: 7,
  červenec: 7,
  srpen: 8,
  zari: 9,
  září: 9,
  rijen: 10,
  říjen: 10,
  listopad: 11,
  prosinec: 12,
};

function looksLikeNaturalLanguage(q: string): boolean {
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length >= 4) return true;
  return /\b(najdi|najít|ukaž|ukaz|vsechny|všechny|kde|od|za|kolem|asi|minuly|minulý|posledni|poslední)\b/i.test(
    q
  );
}

function parseMonthRange(text: string, now: Date): { from: string; to: string } | null {
  const norm = normalizeSearchText(text);
  for (const [name, month] of Object.entries(MONTHS)) {
    if (!norm.includes(name)) continue;
    const yearMatch = norm.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
    const start = new Date(year, month - 1, 1);
    const end = endOfMonth(start);
    return { from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") };
  }
  return null;
}

function parseRelativeDates(text: string, now: Date): { from: string; to: string } | null {
  const norm = normalizeSearchText(text);
  if (norm.includes("minuly mesic") || norm.includes("minulý měsíc")) {
    const start = startOfMonth(subMonths(now, 1));
    const end = endOfMonth(subMonths(now, 1));
    return { from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") };
  }
  if (norm.includes("minuly tyden") || norm.includes("minulý týden")) {
    const start = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const end = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    return { from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") };
  }
  if (norm.includes("posledni 3 mesice") || norm.includes("poslední 3 měsíce")) {
    const start = startOfMonth(subMonths(now, 2));
    const end = endOfMonth(now);
    return { from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") };
  }
  if (norm.includes("letos")) {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: format(start, "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
  }
  return null;
}

function parseAmountFilters(text: string): {
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
} {
  const norm = normalizeSearchText(text);
  let amountMin: number | null = null;
  let amountMax: number | null = null;
  const currency = /\beur\b|€/.test(norm) ? "EUR" : "CZK";

  const approx = norm.match(/(?:asi|kolem)\s+(\d[\d\s.,]*(?:\s*tis(?:ic)?)?)/);
  if (approx) {
    const v = parseCzechAmountToken(approx[1]);
    if (v != null) {
      const r = amountRangeFromApprox(v);
      amountMin = r.min;
      amountMax = r.max;
      return { amountMin, amountMax, currency };
    }
  }

  const nad = norm.match(/(?:nad|pres|přes|vice|více)\s+(?:než\s+)?(\d[\d\s.,]*(?:\s*tis(?:ic)?)?)/);
  if (nad) {
    const v = parseCzechAmountToken(nad[1]);
    if (v != null) amountMin = v;
  }

  const pod = norm.match(/(?:pod|do|max)\s+(\d[\d\s.,]*(?:\s*tis(?:ic)?)?)/);
  if (pod) {
    const v = parseCzechAmountToken(pod[1]);
    if (v != null) amountMax = v;
  }

  const plain = norm.match(/(\d[\d\s.,]{3,})\s*(?:kc|kč|czk)?/);
  if (plain && amountMin == null && amountMax == null) {
    const raw = plain[1].replace(/\s/g, "").replace(",", ".");
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 1000) {
      const r = amountRangeFromApprox(v);
      amountMin = r.min;
      amountMax = r.max;
    }
  }

  return { amountMin, amountMax, currency };
}

function extractDocumentNumber(text: string): string | null {
  const m = text.match(DOC_NUMBER_RE) ?? text.match(GENERIC_NUMBER_RE);
  return m ? m[0].replace(/\s+/g, "").toUpperCase() : null;
}

function extractEntityTypes(text: string): SearchEntityType[] | null {
  const types = new Set<SearchEntityType>();
  for (const hint of ENTITY_HINTS) {
    if (hint.re.test(text)) hint.types.forEach((t) => types.add(t));
  }
  return types.size ? [...types] : null;
}

function extractSupplierCustomer(text: string): { supplier: string | null; customer: string | null } {
  const norm = text.trim();
  const od = norm.match(/\b(?:od|dodavatel(?:e)?)\s+([A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž0-9 .-]{2,40})/i);
  if (od) return { supplier: od[1].trim(), customer: null };
  const pro = norm.match(/\b(?:pro|zakaznik|zákazník)\s+([A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž0-9 .-]{2,40})/i);
  if (pro) return { supplier: null, customer: pro[1].trim() };
  return { supplier: null, customer: null };
}

function extractJobQuery(text: string): string | null {
  const m = text.match(/\b(?:k\s+zak[aá]zce|zak[aá]zka)\s+([A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž0-9 .-]{2,40})/i);
  return m ? m[1].trim() : null;
}

export function parseSearchQueryDeterministic(rawQuery: string, now = new Date()): SearchIntent {
  const rawQueryTrimmed = rawQuery.trim();
  const normalized = normalizeSearchText(rawQueryTrimmed);
  const exactCandidate = normalizeExactKey(rawQueryTrimmed);

  const docNum = extractDocumentNumber(rawQueryTrimmed);
  const entityTypes = extractEntityTypes(normalized);
  const { supplier, customer } = extractSupplierCustomer(rawQueryTrimmed);
  const jobQuery = extractJobQuery(rawQueryTrimmed);
  const monthRange = parseMonthRange(normalized, now) ?? parseRelativeDates(normalized, now);
  const amounts = parseAmountFilters(normalized);

  const isExactOnly =
    !!docNum ||
    (exactCandidate.length >= 4 &&
      !looksLikeNaturalLanguage(normalized) &&
      /^[A-Z0-9@.+_-]+$/i.test(rawQueryTrimmed.replace(/\s/g, "")));

  const useAiParser =
    looksLikeNaturalLanguage(normalized) &&
    !isExactOnly &&
    (!docNum || normalized.split(/\s+/).length > 2) &&
    meaningfulQueryTokens(rawQueryTrimmed).length > 0;

  const intent: SearchIntent = {
    rawQuery: rawQueryTrimmed,
    entityTypes,
    supplier,
    customer,
    jobQuery,
    documentNumber: docNum,
    amountMin: amounts.amountMin,
    amountMax: amounts.amountMax,
    currency: amounts.currency,
    dateFrom: monthRange?.from ?? null,
    dateTo: monthRange?.to ?? null,
    semanticQuery: null,
    useAiParser,
  };

  intent.entityListing = isEntityListingIntent(intent);

  if (!intent.entityListing && !isExactOnly) {
    const tokens = meaningfulQueryTokens(rawQueryTrimmed);
    if (tokens.length >= 2 || (tokens.length === 1 && !entityTypes?.length)) {
      intent.semanticQuery = rawQueryTrimmed;
    }
  }

  if (intent.entityListing) {
    intent.useAiParser = false;
    intent.semanticQuery = null;
  }

  return intent;
}

export function isLikelyExactSearch(intent: SearchIntent): boolean {
  if (intent.documentNumber) return true;
  const key = normalizeExactKey(intent.rawQuery);
  if (key.length >= 5 && !intent.useAiParser) return true;
  const digits = digitsOnly(intent.rawQuery);
  return digits.length >= 8 && !intent.useAiParser;
}

export function exactKeysFromQuery(query: string): string[] {
  const keys = new Set<string>();
  const norm = normalizeExactKey(query);
  if (norm) keys.add(norm);
  const doc = extractDocumentNumber(query);
  if (doc) keys.add(normalizeExactKey(doc));
  const digits = digitsOnly(query);
  if (digits.length >= 6) keys.add(digits);
  return [...keys];
}
