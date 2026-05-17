/**
 * Test calculateJobPaymentSummary logiky (Zbývá doplatit = cena − zaplaceno).
 * node scripts/test-job-payment-summary.mjs
 */

import assert from "node:assert/strict";

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function resolvePaymentStatus(requiredGross, paidGross) {
  if (requiredGross <= 0.009) return "—";
  if (paidGross <= 0.009) return "nezaplaceno";
  if (paidGross >= requiredGross - 0.01) return "zaplaceno";
  return "částečně zaplaceno";
}

function calculateJobPaymentSummary({ job }) {
  const totalPriceGross = roundMoney2(
    Number(job.contractManual?.totalPriceGross) ||
      Number(job.budgetGross) ||
      0
  );
  const manualDepositGross = roundMoney2(
    Number(job.contractManual?.paidDepositGross) || 0
  );
  const totalPaidGross = roundMoney2(Number(job.paidAmountGross) || 0);
  const paymentsDepositGross = roundMoney2(
    Math.max(0, totalPaidGross - manualDepositGross)
  );
  const remainingToPayGross = Math.max(
    0,
    roundMoney2(totalPriceGross - totalPaidGross)
  );
  const requiredDepositGross = roundMoney2(
    Number(job.contractManual?.requiredDepositGross) || 0
  );
  const totalDepositPaidGross = roundMoney2(
    manualDepositGross + paymentsDepositGross
  );
  return {
    totalPriceGross,
    totalPaidGross,
    paymentsDepositGross,
    remainingToPayGross,
    depositStatus: resolvePaymentStatus(requiredDepositGross, totalDepositPaidGross),
    jobPaymentStatus: resolvePaymentStatus(totalPriceGross, totalPaidGross),
  };
}

// Případ z požadavku: 4 400 400 − 200 000 = 4 200 400
const main = calculateJobPaymentSummary({
  job: {
    paidAmountGross: 200000,
    contractManual: {
      isContracted: true,
      totalPriceGross: 4400400,
      requiredDepositGross: 200000,
    },
  },
});
assert.equal(main.totalPriceGross, 4400400);
assert.equal(main.totalPaidGross, 200000);
assert.equal(main.remainingToPayGross, 4200400);
assert.equal(main.jobPaymentStatus, "částečně zaplaceno");
assert.equal(main.paymentsDepositGross, 200000);

console.log("OK: testy job-payment-summary prošly.");
