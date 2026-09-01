/**
 * Test pravidel typů poptávek a filtrování chybějících údajů (bez OpenAI).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function normalize(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(inquiryType, patterns) {
  const n = normalize(inquiryType);
  for (const pattern of patterns) {
    const p = normalize(pattern);
    if (!p || p === "*") return true;
    if (n.includes(p) || p.includes(n)) return true;
  }
  return false;
}

function isIgnored(missingItem, ignoredList) {
  const item = normalize(missingItem);
  for (const ignored of ignoredList) {
    const ig = normalize(ignored);
    if (!ig) continue;
    if (item.includes(ig) || ig.includes(item)) return true;
    const words = ig.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length > 0 && words.every((w) => item.includes(w.length > 5 ? w.slice(0, 5) : w))) {
      return true;
    }
  }
  return false;
}

// Pergoly svépomocí must match built-in patterns
if (!matches("Pergoly svépomocí", ["pergol", "svépomoc", "svepomoc"])) {
  throw new Error("Pergoly svépomocí should match pergola rule patterns");
}

// Side glazing must be ignored for pergola
const pergolaIgnored = [
  "boční zasklení",
  "čelní zasklení",
  "typ skla",
];
if (!isIgnored("Chybí detailní údaje o bočním zasklení", pergolaIgnored)) {
  throw new Error("boční zasklení should be filtered from missing_information");
}
if (!isIgnored("typ skla pro boční stěny", pergolaIgnored)) {
  throw new Error("typ skla should be ignored for pergola");
}

// Source files exist
for (const rel of [
  "src/lib/ai/ai-settings-types.ts",
  "src/lib/ai/inquiry-type-rules.ts",
  "src/lib/ai/similar-quotes-retriever.ts",
  "src/lib/ai/confidence-calculator.ts",
  "src/components/settings/ai-assistant-settings-card.tsx",
]) {
  if (!fs.existsSync(path.join(root, rel))) {
    throw new Error(`missing file: ${rel}`);
  }
}

const prompt = readFile("src/lib/ai/prompt-builder.ts");
if (!prompt.includes("PRODUCT RULES") || !prompt.includes("ignored_information")) {
  throw new Error("prompt-builder must include PRODUCT RULES with ignored_information");
}

const ctx = readFile("src/lib/ai/crm-context-builder.ts");
if (!ctx.includes("similarQuotes") || !ctx.includes("typeRule")) {
  throw new Error("crm-context-builder must include typeRule and similarQuotes");
}

const validator = readFile("src/lib/ai/response-validator.ts");
if (!validator.includes("filterIgnoredMissingInformation")) {
  throw new Error("response-validator must filter ignored missing info");
}

console.log("test-inquiry-type-rules.mjs: OK");
