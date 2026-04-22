/**
 * Nápověda portálu — dynamický obsah z kolekce `helpContent` ve Firestore.
 */

import type { PortalAssistantReply } from "@/lib/portal-assistant-knowledge";

export const HELP_CONTENT_FALLBACK = "Nápověda zatím není nastavena";

/** Hodnoty pole `module` (shodné s administrací). */
export const HELP_PORTAL_MODULES = [
  { value: "obecne", label: "Obecné / přehled" },
  { value: "zakazky", label: "Zakázky" },
  { value: "doklady", label: "Dokumenty" },
  { value: "vyroba", label: "Výroba" },
  { value: "sklad", label: "Sklad" },
  { value: "faktury", label: "Faktury" },
  { value: "schuzky", label: "Schůzky / zápisy" },
  { value: "zaměstnanci", label: "Zaměstnanci" },
  { value: "dochazka", label: "Docházka / labor" },
  { value: "potencialni", label: "Potenciální zákazníci" },
  { value: "finance", label: "Finance" },
  { value: "nastaveni", label: "Nastavení" },
] as const;

export type HelpPortalModule = (typeof HELP_PORTAL_MODULES)[number]["value"];

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

function normalizeCs(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Odvození modulu nápovědy z cesty v portálu. */
export function pathnameToHelpModule(pathname: string): HelpPortalModule {
  const p = pathname || "";
  if (p.startsWith("/portal/jobs")) return "zakazky";
  if (p.startsWith("/portal/documents")) return "doklady";
  if (p.startsWith("/portal/vyroba")) return "vyroba";
  if (p.startsWith("/portal/sklad")) return "sklad";
  if (p.startsWith("/portal/invoices")) return "faktury";
  if (p.startsWith("/portal/meeting-records")) return "schuzky";
  if (p.startsWith("/portal/employees") || p.startsWith("/portal/employee")) return "zaměstnanci";
  if (p.startsWith("/portal/labor")) return "dochazka";
  if (p.startsWith("/portal/leads")) return "potencialni";
  if (p.startsWith("/portal/finance")) return "finance";
  if (p.startsWith("/portal/settings")) return "nastaveni";
  if (p.startsWith("/portal/dashboard") || p.startsWith("/portal")) return "obecne";
  return "obecne";
}

function parseKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => String(k ?? "").trim()).filter(Boolean);
}

export function parseHelpContentDoc(id: string, data: Record<string, unknown> | undefined): HelpContentRow | null {
  if (!data) return null;
  const companyId = String(data.companyId ?? "").trim();
  const module = String(data.module ?? "").trim();
  const question = String(data.question ?? "").trim();
  const answer = String(data.answer ?? "").trim();
  if (!companyId || !module || !question || !answer) return null;
  return {
    id,
    companyId,
    module,
    question,
    answer,
    keywords: parseKeywords(data.keywords),
    order: typeof data.order === "number" && !Number.isNaN(data.order) ? data.order : 0,
    isActive: data.isActive !== false,
  };
}

export function mergeHelpRowsForPortal(
  rows: HelpContentRow[],
  companyId: string | null | undefined
): HelpContentRow[] {
  const cid = String(companyId ?? "").trim();
  const filtered = rows.filter(
    (r) => r.isActive && (r.companyId === "global" || (cid && r.companyId === cid))
  );
  filtered.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.companyId !== b.companyId) return a.companyId === cid ? -1 : b.companyId === cid ? 1 : 0;
    return a.question.localeCompare(b.question, "cs");
  });
  return filtered;
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
