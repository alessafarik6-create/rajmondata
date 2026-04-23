/**
 * Nápověda portálu — dynamický obsah z kolekce `helpContent` ve Firestore.
 * Modul v DB je stabilní `value` (např. jobs, dashboard); staré záznamy (obecne, label) se normalizují.
 */

import type { PortalAssistantReply } from "@/lib/portal-assistant-knowledge";

export const HELP_CONTENT_FALLBACK = "Nápověda zatím není nastavena";

/** Select: value do Firestore, label pro uživatele. */
export const HELP_PORTAL_MODULES = [
  { value: "dashboard", label: "Obecné / přehled" },
  { value: "jobs", label: "Zakázky" },
  { value: "documents", label: "Doklady" },
  { value: "production", label: "Výroba" },
  { value: "stock", label: "Sklad" },
  { value: "invoices", label: "Fakturace" },
  { value: "meetings", label: "Schůzky" },
  { value: "customer_chats", label: "Zákaznické chaty" },
  { value: "employees", label: "Zaměstnanci" },
  { value: "labor", label: "Docházka / labor" },
  { value: "leads", label: "Potenciální zákazníci" },
  { value: "finance", label: "Finance" },
  { value: "settings", label: "Nastavení" },
] as const;

export type HelpPortalModuleValue = (typeof HELP_PORTAL_MODULES)[number]["value"];

const CANONICAL_VALUES = new Set<string>(HELP_PORTAL_MODULES.map((m) => m.value));

function normalizeCs(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Staré kódy modulů (před sjednocení) → kanonická hodnota. */
const LEGACY_CODE_TO_CANON: Record<string, HelpPortalModuleValue> = {
  obecne: "dashboard",
  zakazky: "jobs",
  doklady: "documents",
  vyroba: "production",
  sklad: "stock",
  faktury: "invoices",
  fakturace: "invoices",
  schuzky: "meetings",
  zamestnanci: "employees",
  dochazka: "labor",
  potencialni: "leads",
  nastaveni: "settings",
};

/**
 * Převede uložené pole `module` (kanonické value, starý kód, nebo omylem uložený label) na kanonickou value.
 */
export function normalizeHelpModuleStored(raw: string): HelpPortalModuleValue | string {
  const t = String(raw ?? "").trim();
  if (!t) return "dashboard";
  if (CANONICAL_VALUES.has(t)) return t as HelpPortalModuleValue;

  const byCode = LEGACY_CODE_TO_CANON[normalizeCs(t)];
  if (byCode) return byCode;

  const n = normalizeCs(t);
  for (const m of HELP_PORTAL_MODULES) {
    if (normalizeCs(m.label) === n) return m.value;
  }
  return t;
}

/** Pro zápis z API / migraci: jen známé kanonické moduly. */
export function coerceHelpModuleToCanonical(input: string): HelpPortalModuleValue | null {
  const v = normalizeHelpModuleStored(input);
  return CANONICAL_VALUES.has(v) ? (v as HelpPortalModuleValue) : null;
}

export type HelpContentDoc = {
  companyId: string;
  module: string;
  question: string;
  answer: string;
  keywords: string[];
  order: number;
  isActive: boolean;
};

export type HelpContentRow = HelpContentDoc & { id: string };

function parseKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => String(k ?? "").trim()).filter(Boolean);
}

function parseOrder(raw: unknown): number {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseHelpContentDoc(id: string, data: Record<string, unknown> | undefined): HelpContentRow | null {
  if (!data) return null;
  const companyId = String(data.companyId ?? "").trim();
  const moduleRaw = String(data.module ?? "").trim();
  const question = String(data.question ?? "").trim();
  const answer = String(data.answer ?? "").trim();
  if (!companyId || !question || !answer) return null;
  return {
    id,
    companyId,
    module: moduleRaw || "dashboard",
    question,
    answer,
    keywords: parseKeywords(data.keywords),
    order: parseOrder(data.order),
    isActive: data.isActive !== false,
  };
}

/**
 * Přesné řetězce v poli `module` ve Firestore, které mají patřit k danému kanonickému modulu (kvůli `where('module','in', …)`).
 */
export function firestoreModuleVariantsForCanonical(canonical: HelpPortalModuleValue | string): string[] {
  const c = String(canonical).trim() as HelpPortalModuleValue;
  const out = new Set<string>();
  if (CANONICAL_VALUES.has(c)) {
    out.add(c);
    const def = HELP_PORTAL_MODULES.find((m) => m.value === c);
    if (def) out.add(def.label);
  }
  for (const [legacy, canon] of Object.entries(LEGACY_CODE_TO_CANON)) {
    if (canon === c) {
      out.add(legacy);
      out.add(legacy.toUpperCase());
    }
  }
  return [...out].filter(Boolean);
}

/** Rozdělí seznam variant na chunky po max. 10 (limit Firestore `in`). */
export function chunkFirestoreIn<T>(items: T[], size = 10): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sjednotí načtené řádky v pořadí:
 * 1) firma + aktuální modul, 2) global + aktuální modul,
 * 3) firma + dashboard, 4) global + dashboard (jen pokud aktuální modul není už jen dashboard v krocích 1–2).
 */
export function mergeHelpRowsByFallbackTiers(
  rows: HelpContentRow[],
  currentModuleCanon: HelpPortalModuleValue | string,
  companyId: string | null | undefined
): HelpContentRow[] {
  const cid = String(companyId ?? "").trim();
  const current = String(normalizeHelpModuleStored(String(currentModuleCanon))).trim() as HelpPortalModuleValue;
  const seen = new Set<string>();
  const out: HelpContentRow[] = [];

  const pushTier = (modCanon: HelpPortalModuleValue | string, companyScope: string) => {
    const m = normalizeHelpModuleStored(String(modCanon)) as HelpPortalModuleValue;
    rows
      .filter(
        (r) =>
          !seen.has(r.id) &&
          r.isActive !== false &&
          String(r.companyId ?? "").trim() === companyScope &&
          normalizeHelpModuleStored(r.module) === m
      )
      .sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.question.localeCompare(b.question, "cs")
      )
      .forEach((r) => {
        seen.add(r.id);
        out.push(r);
      });
  };

  if (current === "dashboard") {
    if (cid) pushTier("dashboard", cid);
    pushTier("dashboard", "global");
    return out;
  }

  if (cid) pushTier(current, cid);
  pushTier(current, "global");
  if (cid) pushTier("dashboard", cid);
  pushTier("dashboard", "global");
  return out;
}

/** Sloučení podle tierů (firma → global → dashboard). */
export function mergeHelpRowsForPortal(
  rows: HelpContentRow[],
  companyId: string | null | undefined,
  currentModule?: string
): HelpContentRow[] {
  const mod = coerceHelpModuleToCanonical(String(currentModule ?? "dashboard")) ?? "dashboard";
  return mergeHelpRowsByFallbackTiers(rows, mod, companyId);
}

/** Odvození kanonického modulu z cesty v portálu. */
export function pathnameToHelpModule(pathname: string): HelpPortalModuleValue {
  const p = pathname || "";
  if (p.startsWith("/portal/jobs")) return "jobs";
  if (p.startsWith("/portal/documents")) return "documents";
  if (p.startsWith("/portal/vyroba")) return "production";
  if (p.startsWith("/portal/sklad")) return "stock";
  if (p.startsWith("/portal/invoices")) return "invoices";
  if (p.startsWith("/portal/meeting-records")) return "meetings";
  if (p.startsWith("/portal/customer-chats")) return "customer_chats";
  if (p.startsWith("/portal/employees") || p.startsWith("/portal/employee")) return "employees";
  if (p.startsWith("/portal/labor")) return "labor";
  if (p.startsWith("/portal/leads")) return "leads";
  if (p.startsWith("/portal/finance")) return "finance";
  if (p.startsWith("/portal/settings")) return "settings";
  if (p.startsWith("/portal/dashboard")) return "dashboard";
  if (p.startsWith("/portal")) return "dashboard";
  return "dashboard";
}

/** Skóre relevance dotazu k řádku nápovědy (vyšší = lepší). */
export function scoreHelpQuery(query: string, row: HelpContentRow): number {
  const q = normalizeCs(query);
  if (!q) return 0;
  const nq = normalizeCs(row.question);
  const qTokens = q.split(" ").filter((t) => t.length > 1);
  let score = 0;
  if (q === nq) score += 120;
  else if (q.includes(nq) || nq.includes(q)) score += 70;
  else {
    for (const t of qTokens) {
      if (nq.includes(t)) score += 12;
    }
  }
  for (const kw of row.keywords) {
    const nk = normalizeCs(kw);
    if (!nk) continue;
    if (q.includes(nk)) score += 25;
    if (qTokens.some((t) => nk.includes(t) || t.includes(nk))) score += 10;
  }
  return score;
}

export function bestHelpReplyFromRows(
  query: string,
  rows: HelpContentRow[],
  minScore = 18
): PortalAssistantReply | null {
  const q = query.trim();
  if (!q || rows.length === 0) return null;
  let best: HelpContentRow | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const s = scoreHelpQuery(q, row);
    if (s > bestScore) {
      bestScore = s;
      best = row;
    }
  }
  if (!best || bestScore < minScore) return null;
  return { text: best.answer };
}
