/**
 * Regrese: souhrn k úhradě — soft-delete a zrcadla faktur.
 * npx --yes tsx scripts/test-portal-payment-summary.mjs
 */
import assert from "node:assert/strict";

import { isActiveFirestoreDoc } from "../src/lib/document-soft-delete.ts";
import {
  computePortalPaymentOverviewStats,
  isPortalInvoiceMirrorDocument,
} from "../src/lib/portal-payment-summary.ts";

const todayIso = "2026-09-16";

assert.equal(isActiveFirestoreDoc({ isDeleted: true }), false);
assert.equal(isActiveFirestoreDoc({ deletedAt: { toMillis: () => 1 } }), false);
assert.equal(isActiveFirestoreDoc({ isDeleted: false }), true);

const mirrorDoc = {
  id: "doc-mirror",
  type: "issued",
  requiresPayment: true,
  amountGrossCZK: 100_000_000,
  castkaCZK: 100_000_000,
  sourceInvoiceId: "inv-1",
  dueDate: "2026-01-01",
};

assert.equal(isPortalInvoiceMirrorDocument(mirrorDoc), true);

const invoice = {
  id: "inv-1",
  status: "issued",
  amountGross: 100_000_000,
  dueDate: "2026-01-01",
};

let stats = computePortalPaymentOverviewStats([mirrorDoc], [invoice], todayIso);
assert.equal(stats.totalKc, 100_000_000);
assert.equal(stats.toPay, 1);

stats = computePortalPaymentOverviewStats([mirrorDoc], [{ ...invoice, isDeleted: true }], todayIso);
assert.equal(stats.totalKc, 0, "smazaná faktura + zrcadlo dokladu nesmí nic počítat");

stats = computePortalPaymentOverviewStats(
  [{ ...mirrorDoc, isDeleted: true }],
  [invoice],
  todayIso
);
assert.equal(stats.totalKc, 100_000_000, "aktivní faktura bez smazaného zrcadla");

const manualDoc = {
  id: "doc-manual",
  type: "received",
  requiresPayment: true,
  castkaCZK: 50_000,
  dueDate: "2026-12-01",
};

stats = computePortalPaymentOverviewStats([manualDoc], [], todayIso);
assert.equal(stats.totalKc, 50_000);

stats = computePortalPaymentOverviewStats(
  [manualDoc],
  [],
  todayIso
);
const before = stats.totalKc;
stats = computePortalPaymentOverviewStats(
  [{ ...manualDoc, isDeleted: true, deletedAt: new Date() }],
  [],
  todayIso
);
assert.equal(stats.totalKc, before - 50_000);

console.log("test-portal-payment-summary: OK");
