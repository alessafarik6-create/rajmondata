/**
 * Deterministický test knowledge query intent parseru.
 * Spuštění: npx tsx scripts/test-knowledge-search.ts
 */

import { parseKnowledgeQueryIntent } from "../src/lib/ai/knowledge-query-intent";

const cases: Array<{ q: string; expect: "knowledge_question" | "crm_search" }> = [
  { q: "jak je udělaný spoj pergoly BKS", expect: "knowledge_question" },
  { q: "ukaž mi nákres spoje pergoly bks", expect: "knowledge_question" },
  { q: "FV2026-123", expect: "crm_search" },
  { q: "faktura FV2026-0145", expect: "crm_search" },
  { q: "kolik stojí pergola 5x3", expect: "crm_search" },
];

let pass = 0;
for (const c of cases) {
  const intent = parseKnowledgeQueryIntent(c.q);
  const ok = intent.intent === c.expect;
  console.log(`${ok ? "PASS" : "FAIL"}: "${c.q}" → ${intent.intent} (expected ${c.expect})`);
  if (ok) pass += 1;
}

console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
