/**
 * Rychlý deterministický test parseru a missing resolveru (bez OpenAI / Firebase).
 * Spuštění: npx tsx scripts/test-inquiry-ai-logic.ts
 */

import { defaultBuiltInInquiryTypeRules } from "../src/lib/ai/ai-settings-types";
import { parseInquiryFields } from "../src/lib/ai/inquiry-field-parser";
import { parseInquiryDimensions } from "../src/lib/ai/dimension-parser";
import { resolveAiMissingInformation } from "../src/lib/ai/inquiry-missing-resolver";
import { runPriceEngine } from "../src/lib/ai/price-engine";
import type { AiPriceRuleDoc } from "../src/lib/ai/ai-center-types";

const INQUIRY_TEXT = "Pergola 5 × 3 m, polykarbonát 16 mm";
const typeRule = defaultBuiltInInquiryTypeRules("test").find((r) => r.name === "Pergoly svépomocí")!;

console.log("=== DIMENSION PARSER ===");
const dims = parseInquiryDimensions(INQUIRY_TEXT);
console.log(JSON.stringify(dims, null, 2));

console.log("\n=== FIELD PARSER ===");
const parsed = parseInquiryFields(INQUIRY_TEXT, typeRule);
console.log({
  widthMm: parsed.dimensions.widthMm,
  depthMm: parsed.dimensions.depthMm,
  areaM2: parsed.dimensions.areaM2,
  roof: parsed.roofMaterial,
  quantity: parsed.quantity,
  required: parsed.requiredFields,
  optional: parsed.optionalFields,
  satisfied: parsed.satisfiedRequired,
  missing: parsed.missingRequired,
});

console.log("\n=== MISSING RESOLVER (simulace AI výstupu s volitelnými poli) ===");
const resolved = resolveAiMissingInformation({
  rawMissing: [
    "barva nebo konstrukční varianta pergoly",
    "počet kusů",
    "boční zasklení",
  ],
  typeRule,
  inquiryText: INQUIRY_TEXT,
});
console.log("missing_information:", resolved.missingInformation);
console.log("stripped optional:", resolved.strippedOptional);
console.log("stripped ignored:", resolved.strippedIgnored);

console.log("\n=== PRICE ENGINE (mock pravidlo 4500 Kč/m2) ===");
const mockRule: AiPriceRuleDoc = {
  id: "test-pergola-base",
  name: "Pergola svépomocí – základní cena",
  inquiryType: "Pergoly svépomocí",
  calculationType: "per_m2",
  value: 4500,
  currency: "Kč",
  active: true,
  priority: 100,
  companyId: "test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const price = runPriceEngine({
  items: [],
  products: [],
  priceRules: [mockRule],
  inquiryType: "Pergoly svépomocí",
  typeRuleName: typeRule.name,
  inquiryText: INQUIRY_TEXT,
});
console.log(
  "applied:",
  price.explainability.appliedLines.map((l) => l.expression)
);
console.log("total net:", price.items.reduce((s, i) => s + i.lineNet, 0));

const ok =
  parsed.dimensions.widthMm === 5000 &&
  parsed.dimensions.depthMm === 3000 &&
  parsed.dimensions.areaM2 === 15 &&
  parsed.quantity === 1 &&
  parsed.missingRequired.length === 0 &&
  resolved.missingInformation.length === 0 &&
  price.items.some((i) => i.lineNet === 67500);

console.log("\n=== TEST RESULT ===", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
