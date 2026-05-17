/**
 * Test calculateJobDepositSummary (stejná logika jako export PDF).
 * node scripts/test-contracted-jobs-export.mjs
 */

import assert from "node:assert/strict";

const JOB_INVOICE_TYPES = {
  ADVANCE: "advance_invoice",
  TAX_RECEIPT: "tax_receipt_received_payment",
};

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function parseJobContractManual(job) {
  const raw = job?.contractManual;
  if (!raw || typeof raw !== "object") return {};
  return {
    isContracted: raw.isContracted === true,
    paidDepositGross:
      raw.paidDepositGross != null ? roundMoney2(Number(raw.paidDepositGross)) : null,
    requiredDepositGross:
      raw.requiredDepositGross != null
        ? roundMoney2(Number(raw.requiredDepositGross))
        : null,
  };
}

function calculateJobDepositSummary({ job, invoices = [], jobIncomes = [] }) {
  const manual = parseJobContractManual(job);
  const manualDepositGross = roundMoney2(Math.max(0, Number(manual.paidDepositGross) || 0));
  const requiredDepositGross = roundMoney2(Math.max(0, Number(manual.requiredDepositGross) || 0));

  let paymentsDepositGross = 0;
  const advances = invoices.filter((i) => i.type === JOB_INVOICE_TYPES.ADVANCE);
  for (const a of advances) {
    const cap = roundMoney2(Number(a.amountGross) || 0);
    const paid = roundMoney2(Number(a.paidGrossReceived) || 0);
    paymentsDepositGross = roundMoney2(
      paymentsDepositGross + (cap > 0 ? Math.min(paid, cap) : paid)
    );
  }
  for (const inc of jobIncomes) {
    paymentsDepositGross = roundMoney2(
      paymentsDepositGross + (Number(inc.amountGross) || 0)
    );
  }

  const jobPaidGross = roundMoney2(Number(job.paidAmountGross) || 0);
  const counted = roundMoney2(manualDepositGross + paymentsDepositGross);
  if (jobPaidGross > counted + 0.009) {
    const cap =
      requiredDepositGross > 0.009
        ? roundMoney2(Math.max(0, requiredDepositGross - counted))
        : roundMoney2(jobPaidGross - counted);
    const residual = roundMoney2(Math.min(jobPaidGross - counted, cap));
    if (residual > 0.009) paymentsDepositGross = roundMoney2(paymentsDepositGross + residual);
  }

  const totalDepositPaidGross = roundMoney2(manualDepositGross + paymentsDepositGross);
  const depositRemainingGross = Math.max(
    0,
    roundMoney2(requiredDepositGross - totalDepositPaidGross)
  );
  let depositStatus = "—";
  if (requiredDepositGross > 0.009) {
    if (totalDepositPaidGross <= 0.009) depositStatus = "nezaplaceno";
    else if (totalDepositPaidGross >= requiredDepositGross - 0.01) depositStatus = "zaplaceno";
    else depositStatus = "částečně uhrazeno";
  }
  return {
    requiredDepositGross,
    manualDepositGross,
    paymentsDepositGross,
    totalDepositPaidGross,
    depositRemainingGross,
    depositStatus,
  };
}

// Ručně zadaná záloha
const manualOnly = calculateJobDepositSummary({
  job: {
    contractManual: { isContracted: true, requiredDepositGross: 200000, paidDepositGross: 50000 },
  },
  invoices: [],
});
assert.equal(manualOnly.manualDepositGross, 50000);
assert.equal(manualOnly.totalDepositPaidGross, 50000);

// Finanční přehled 200k bez dokladů
const fromJobPaid = calculateJobDepositSummary({
  job: {
    paidAmountGross: 200000,
    contractManual: { isContracted: true, requiredDepositGross: 200000 },
  },
  invoices: [],
});
assert.equal(fromJobPaid.totalDepositPaidGross, 200000);
assert.equal(fromJobPaid.depositStatus, "zaplaceno");

// ZF + DD bez dvojího započtení
const inv = [
  { id: "zf1", type: JOB_INVOICE_TYPES.ADVANCE, amountGross: 200000, paidGrossReceived: 200000 },
  {
    id: "dd1",
    type: JOB_INVOICE_TYPES.TAX_RECEIPT,
    relatedInvoiceId: "zf1",
    amountGross: 200000,
  },
];
const fromInv = calculateJobDepositSummary({
  job: { paidAmountGross: 200000, contractManual: { requiredDepositGross: 200000 } },
  invoices: inv,
});
assert.equal(fromInv.paymentsDepositGross, 200000);
assert.equal(fromInv.totalDepositPaidGross, 200000);

console.log("OK: testy job-deposit-summary prošly.");
