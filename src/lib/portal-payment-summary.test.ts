import assert from "node:assert/strict";
import { computePortalPaymentOverviewStats } from "./portal-payment-summary";
import type { CompanyDocumentPaymentRow } from "./company-document-payment";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const today = "2099-01-15";

test("received and issued amounts are not merged in side stats", () => {
  const received: CompanyDocumentPaymentRow = {
    id: "r1",
    type: "received",
    requiresPayment: true,
    dueDate: "2099-02-01",
    castkaCZK: 100_000,
    paymentStatus: "unpaid",
  };
  const stats = computePortalPaymentOverviewStats([received], [], today);
  assert.equal(stats.received.openCount, 1);
  assert.equal(stats.received.openAmountKc, 100_000);
  assert.equal(stats.issued.openCount, 0);
  assert.equal(stats.issued.openAmountKc, 0);
});

test("issued invoice adds to issued only", () => {
  const stats = computePortalPaymentOverviewStats(
    [],
    [
      {
        id: "inv1",
        status: "sent",
        amountGross: 200_000,
        dueDate: "2099-03-01",
      },
    ],
    today
  );
  assert.equal(stats.issued.openCount, 1);
  assert.equal(stats.issued.openAmountKc, 200_000);
  assert.equal(stats.received.openCount, 0);
});

test("partial invoice uses remaining only", () => {
  const stats = computePortalPaymentOverviewStats(
    [],
    [
      {
        id: "inv2",
        status: "sent",
        amountGross: 100_000,
        paidAmount: 40_000,
        paymentStatus: "partial",
        dueDate: "2099-03-01",
      },
    ],
    today
  );
  assert.equal(stats.issued.openAmountKc, 60_000);
});
