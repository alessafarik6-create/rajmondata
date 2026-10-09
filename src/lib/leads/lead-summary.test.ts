import assert from "node:assert/strict";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import {
  computeLeadSummaryStats,
  resolveLeadSummaryValue,
  type LeadSummaryOverlayFields,
} from "@/lib/leads/lead-summary";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const leadA: LeadImportRow = {
  id: "a",
  jmeno: "A",
  telefon: "",
  email: "a@test.cz",
  adresa: "",
  zprava: "",
  typ: "Pergoly",
};

const leadB: LeadImportRow = {
  id: "b",
  jmeno: "B",
  telefon: "",
  email: "b@test.cz",
  adresa: "",
  zprava: "",
  typ: "Domy",
};

const leadC: LeadImportRow = {
  id: "c",
  jmeno: "C",
  telefon: "",
  email: "c@test.cz",
  adresa: "",
  zprava: "",
  typ: "Garáže",
};

test("SUM and AVG ignore NULL manual values", () => {
  const overlayByKey = new Map<string, LeadSummaryOverlayFields>();
  overlayByKey.set("a", { estimatedValue: 100_000 });
  overlayByKey.set("b", { estimatedValue: 200_000 });
  const stats = computeLeadSummaryStats([leadA, leadB, leadC], {
    overlayByKey,
    offers: [],
    filters: {
      search: "",
      filterTyp: "",
      filterTag: "",
      filterContact: "",
      dateFrom: "",
      dateTo: "",
    },
  });
  assert.equal(stats.count, 3);
  assert.equal(stats.estimatedValue, 300_000);
  assert.equal(stats.averageValue, 150_000);
  assert.equal(stats.withoutValue, 1);
});

test("offer price overrides manual estimate for display", () => {
  const v = resolveLeadSummaryValue(
    leadA,
    { estimatedValue: 100_000 },
    { importLeadId: "a", priceGross: 485_000 }
  );
  assert.equal(v.source, "offer");
  assert.equal(v.displayKc, 485_000);
  assert.equal(v.manualKc, 100_000);
});

test("manual type override wins over import typ in filters", () => {
  const overlayByKey = new Map<string, LeadSummaryOverlayFields>();
  overlayByKey.set("a", {
    typ_poptavky: "Montované domy",
    inquiryTypeManual: true,
    estimatedValue: 50_000,
  });
  const stats = computeLeadSummaryStats([leadA], {
    overlayByKey,
    offers: [],
    filters: {
      search: "",
      filterTyp: "Montované domy",
      filterTag: "",
      filterContact: "",
      dateFrom: "",
      dateTo: "",
    },
  });
  assert.equal(stats.count, 1);
  assert.equal(stats.byType[0]?.type, "Montované domy");
});
