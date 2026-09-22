import assert from "node:assert/strict";
import {
  calculatePaymentSummary,
  getDocumentPaymentState,
  getPortalInvoicePaymentState,
} from "./invoice-payment-state";
import { computePortalPaymentOverviewStats } from "./portal-payment-summary";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const today = "2099-06-01";
const pastDue = "2099-01-01";

test("issued invoice partial payment uses remaining only", () => {
  const state = getPortalInvoicePaymentState(
    {
      id: "inv1",
      status: "partially_paid",
      amountGross: 1_000_000,
      paidGrossReceived: 600_000,
      dueDate: pastDue,
    },
    today
  );
  assert.equal(state.remainingAmount, 400_000);
  assert.equal(state.isOverdue, true);
});

test("fully paid overdue invoice is not overdue", () => {
  const state = getPortalInvoicePaymentState(
    {
      id: "inv2",
      status: "paid",
      amountGross: 100_000,
      paidAmount: 100_000,
      dueDate: pastDue,
    },
    today
  );
  assert.equal(state.remainingAmount, 0);
  assert.equal(state.isPaid, true);
  assert.equal(state.isOverdue, false);
});

test("issued summary scenario: unpaid then partial then paid", () => {
  const inv = {
    id: "inv3",
    status: "sent",
    amountGross: 100_000,
    dueDate: pastDue,
  };
  let stats = computePortalPaymentOverviewStats([], [inv], today);
  assert.equal(stats.issued.openCount, 1);
  assert.equal(stats.issued.openAmountKc, 100_000);
  assert.equal(stats.issued.overdueCount, 1);
  assert.equal(stats.issued.overdueAmountKc, 100_000);

  stats = computePortalPaymentOverviewStats(
    [],
    [
      {
        ...inv,
        status: "partially_paid",
        paidGrossReceived: 40_000,
      },
    ],
    today
  );
  assert.equal(stats.issued.openCount, 1);
  assert.equal(stats.issued.openAmountKc, 60_000);
  assert.equal(stats.issued.overdueAmountKc, 60_000);

  stats = computePortalPaymentOverviewStats(
    [],
    [{ ...inv, status: "paid", paidAmount: 100_000, paidGrossReceived: 100_000 }],
    today
  );
  assert.equal(stats.issued.openCount, 0);
  assert.equal(stats.issued.overdueCount, 0);
});

test("received document partial payment", () => {
  const doc = {
    id: "d1",
    type: "received",
    requiresPayment: true,
    castkaCZK: 100_000,
    paymentStatus: "partial",
    paidAmount: 40_000,
    dueDate: pastDue,
  };
  const state = getDocumentPaymentState(doc, today);
  assert.equal(state.remainingAmount, 60_000);
  assert.equal(state.isOverdue, true);

  const stats = computePortalPaymentOverviewStats([doc], [], today);
  assert.equal(stats.received.openAmountKc, 60_000);
  assert.equal(stats.received.overdueAmountKc, 60_000);
});

test("mirror document paid syncs invoice remaining in summary", () => {
  const inv = {
    id: "inv-m",
    status: "sent",
    amountGross: 50_000,
    dueDate: pastDue,
  };
  const mirror = {
    id: "doc-m",
    type: "issued",
    sourceInvoiceId: "inv-m",
    source: "portalInvoice",
    requiresPayment: true,
    castkaCZK: 50_000,
    paymentStatus: "paid",
    paidAmount: 50_000,
    paid: true,
    dueDate: pastDue,
  };
  const stats = computePortalPaymentOverviewStats([mirror], [inv], today);
  assert.equal(stats.issued.openCount, 0);
  assert.equal(stats.issued.overdueCount, 0);
});

test("overdue total equals received + issued overdue counts", () => {
  const stats = calculatePaymentSummary({
    documents: [
      {
        id: "r1",
        type: "received",
        requiresPayment: true,
        castkaCZK: 10_000,
        dueDate: pastDue,
      },
    ],
    invoices: [
      {
        id: "i1",
        status: "sent",
        amountGross: 20_000,
        dueDate: pastDue,
      },
    ],
    todayIso: today,
    skipPortalInvoiceMirror: () => false,
  });
  const overview = computePortalPaymentOverviewStats(
    [
      {
        id: "r1",
        type: "received",
        requiresPayment: true,
        castkaCZK: 10_000,
        dueDate: pastDue,
      },
    ],
    [{ id: "i1", status: "sent", amountGross: 20_000, dueDate: pastDue }],
    today
  );
  assert.equal(overview.overdueTotal, 2);
  assert.equal(
    overview.received.overdueCount + overview.issued.overdueCount,
    overview.overdueTotal
  );
  assert.equal(stats.received.overdueCount + stats.issued.overdueCount, 2);
});

test("normalize status paid with zero paidAmount", () => {
  const state = getDocumentPaymentState(
    {
      type: "received",
      requiresPayment: true,
      castkaCZK: 80_000,
      paymentStatus: "paid",
      paidAmount: 0,
      dueDate: pastDue,
    },
    today
  );
  assert.equal(state.remainingAmount, 0);
  assert.equal(state.isOverdue, false);
});
