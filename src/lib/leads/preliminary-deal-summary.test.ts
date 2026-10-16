import assert from "node:assert/strict";
import { computePreliminaryDealsSummary } from "@/lib/leads/preliminary-deal-summary";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("converted deals excluded from pipeline value", () => {
  const s = computePreliminaryDealsSummary([
    { status: "predjednano", priceAmount: 100_000 },
    { status: "prevedeno_do_zakazky", priceAmount: 50_000 },
    { status: "zruseno", priceAmount: 999_999 },
  ]);
  assert.equal(s.count, 2);
  assert.equal(s.pipelineValue, 100_000);
  assert.equal(s.convertedValue, 50_000);
});

test("status buckets", () => {
  const s = computePreliminaryDealsSummary([
    { status: "ceka_na_potvrzeni", priceAmount: 10 },
    { status: "potvrzeno", priceAmount: 20 },
  ]);
  assert.equal(s.waitingConfirmationValue, 10);
  assert.equal(s.confirmedValue, 20);
  assert.equal(s.pipelineValue, 30);
});
