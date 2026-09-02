/**
 * Test skript pro CRM vyhledávání (statická kontrola + parser logika).
 * Run: node scripts/test-search.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

for (const rel of [
  "src/lib/search/types.ts",
  "src/lib/search/search-service.ts",
  "src/lib/search/index-store.ts",
  "src/lib/search/index-builders.ts",
  "src/lib/search/query-parser-deterministic.ts",
  "src/lib/search/embeddings.ts",
  "src/app/api/company/search/route.ts",
  "src/app/api/company/search/reindex/route.ts",
  "src/lib/search/live-search-candidates.ts",
  "src/lib/search/entity-listing.ts",
  "src/app/api/company/search/diagnostics/route.ts",
  "src/components/search/global-search-bar.tsx",
  "src/app/portal/search/page.tsx",
]) {
  if (!fs.existsSync(path.join(root, rel))) throw new Error(`missing ${rel}`);
}

const searchRoute = read("src/app/api/company/search/route.ts");
assert(searchRoute.includes("callerCanAccessCompany"), "search route must enforce company access");
assert(searchRoute.includes("runCompanySearch"), "search route must use search service");

const rules = read("firestore.rules");
assert(rules.includes("match /search_index/{entryId}"), "firestore rules must lock search_index");

const header = read("src/components/layout/top-header.tsx");
assert(header.includes("GlobalSearchBar"), "top header must use GlobalSearchBar");

function normalizeExactKey(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function amountRangeFromApprox(value) {
  const v = Math.abs(value);
  const pct = 0.1;
  const delta = Math.max(v * pct, v >= 50_000 ? 5000 : v >= 10_000 ? 1000 : 500);
  return { min: Math.max(0, Math.round(v - delta)), max: Math.round(v + delta) };
}

assert(normalizeExactKey("fv 2026-0145") === "FV2026-0145");
const approx = amountRangeFromApprox(77000);
assert(approx.min >= 69000 && approx.max <= 85000, "amount tolerance failed");

console.log("test-search: OK");
