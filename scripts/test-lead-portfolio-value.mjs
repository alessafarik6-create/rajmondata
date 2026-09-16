/**
 * npx --yes tsx scripts/test-lead-portfolio-value.mjs
 */
import assert from "node:assert/strict";

import {
  computeLeadPortfolioStats,
  isActiveInquiryLead,
  resolveLeadValue,
  buildTypeMedianGrossByInquiryType,
} from "../src/lib/lead-portfolio-value.ts";

const lead = {
  id: "L1",
  jmeno: "Test",
  telefon: "123456789",
  email: "a@b.cz",
  adresa: "Praha",
  zprava: "Pergola",
  typ: "Pergola",
};

assert.equal(isActiveInquiryLead({ workflowStatus: "nova" }), true);
assert.equal(isActiveInquiryLead({ workflowStatus: "uzavreno" }), false);

const explicit = resolveLeadValue({
  lead: { ...lead, orientacniCenaKc: 500_000 },
  offer: null,
  aiGen: null,
  typeMedians: {},
});
assert.equal(explicit.source, "explicit_price");
assert.equal(explicit.grossKc, 500_000);

const fromOffer = resolveLeadValue({
  lead: { ...lead, orientacniCenaKc: undefined },
  offer: { importLeadId: "L1", priceGross: 750_000 },
  aiGen: null,
  typeMedians: {},
});
assert.equal(fromOffer.source, "offer");

const medians = buildTypeMedianGrossByInquiryType(
  [
    { importLeadId: "x", priceGross: 400_000 },
    { importLeadId: "y", priceGross: 600_000 },
  ],
  new Map([
    ["x", "Pergola"],
    ["y", "Pergola"],
  ])
);
const stat = resolveLeadValue({
  lead,
  offer: null,
  aiGen: null,
  typeMedians: medians,
});
assert.equal(stat.source, "type_statistic");
assert.ok(stat.grossKc && stat.grossKc > 0);

const stats = computeLeadPortfolioStats(
  [
    lead,
    { ...lead, id: "L2", typ: "Garáž", orientacniCenaKc: undefined },
  ],
  {
    overlayByKey: new Map([
      ["L2", { workflowStatus: "nova", typ: "Garáž" }],
    ]),
    offers: [{ importLeadId: "L2", priceGross: 300_000 }],
    aiGenByLeadKey: new Map(),
    typeMedians: medians,
  }
);
assert.equal(stats.activeCount, 2);
assert.ok(stats.totalGrossKc > 0);
assert.equal(stats.showNotQuantifiedMessage, false);

console.log("test-lead-portfolio-value: OK");
