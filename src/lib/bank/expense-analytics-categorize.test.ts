import assert from "node:assert/strict";
import { suggestExpenseCategory } from "./expense-analytics-categorize";
import type { BankTransactionDoc } from "./types";

function tx(partial: Partial<BankTransactionDoc>): BankTransactionDoc {
  return {
    organizationId: "org1",
    accountId: "a1",
    externalTransactionId: "e1",
    rawHash: "h",
    bookingDate: "2026-10-01",
    amount: -1500,
    currency: "CZK",
    direction: "outgoing",
    classification: "expense",
    ...partial,
  };
}

const g = suggestExpenseCategory(
  tx({ counterpartyName: "GOOGLE*ADS 123", message: "Ads" }),
  []
);
assert.equal(g?.marketingSubcategory, "google_ads");
assert.equal(g?.expenseCategory, "marketing");

const f = suggestExpenseCategory(tx({ counterpartyName: "FACEBK * ADS" }), []);
assert.equal(f?.marketingSubcategory, "meta_ads");

const m = suggestExpenseCategory(tx({ counterpartyName: "META PLATFORMS IRELAND" }), []);
assert.equal(m?.marketingSubcategory, "meta_ads");

console.log("[expense-analytics-categorize.test] OK");
