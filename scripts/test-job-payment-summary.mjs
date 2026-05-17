/**
 * Test calculateJobPaymentSummary logiky.
 * node scripts/test-job-payment-summary.mjs
 */

import assert from "node:assert/strict";

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function resolveDepositPaymentStatus(
  totalPriceGross,
  totalPaidGross,
  requiredDepositGross,
  depositPaidGross
) {
  if (requiredDepositGross <= 0.009 && depositPaidGross <= 0.009) return "—";
  if (depositPaidGross <= 0.009) return "nezaplaceno";
  if (totalPriceGross > 0.009 && totalPaidGross >= totalPriceGross - 0.01) {
    return "zaplaceno";
  }
  return "částečně uhrazeno";
}

function resolveJobPaymentStatus(totalPriceGross, totalPaidGross) {
  if (totalPriceGross <= 0.009) {
    return totalPaidGross > 0.009 ? "částečně uhrazeno" : "—";
  }
  if (totalPaidGross <= 0.009) return "nezaplaceno";
  if (totalPaidGross >= totalPriceGross - 0.01) return "zaplaceno";
  return "částečně uhrazeno";
}

function resolveContractedDisplayValue(job) {
  const m = job.contractManual ?? {};
  if (m.contractedAt) {
    const [y, mo, d] = String(m.contractedAt).slice(0, 10).split("-");
    return `${Number(d)}. ${Number(mo)}. ${y}`;
  }
  if (m.isContracted === true) return "ANO";
  return "NE";
}

function calculateJobPaymentSummary({ job }) {
  const totalPriceGross = roundMoney2(Number(job.contractManual?.totalPriceGross) || 0);
  const manualDepositGross = roundMoney2(
    Number(job.contractManual?.paidDepositGross) || 0
  );
  const jobPaidGross = roundMoney2(Number(job.paidAmountGross) || 0);
  const totalPaidGross = roundMoney2(Math.max(jobPaidGross, manualDepositGross));
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
  return {
    totalPriceGross,
    totalPaidGross,
    paymentsDepositGross,
    remainingToPayGross,
    depositStatus: resolveDepositPaymentStatus(
      totalPriceGross,
      totalPaidGross,
      requiredDepositGross,
      totalPaidGross
    ),
    jobPaymentStatus: resolveJobPaymentStatus(totalPriceGross, totalPaidGross),
    contractedDisplayValue: resolveContractedDisplayValue(job),
  };
}

// Ruční záloha 200k, bez paidAmountGross na zakázce
const manualOnly = calculateJobPaymentSummary({
  job: {
    contractManual: {
      isContracted: true,
      totalPriceGross: 4400400,
      requiredDepositGross: 200000,
      paidDepositGross: 200000,
    },
  },
});
assert.equal(manualOnly.totalPaidGross, 200000);
assert.equal(manualOnly.remainingToPayGross, 4200400);
assert.equal(manualOnly.depositStatus, "částečně uhrazeno");
assert.equal(manualOnly.jobPaymentStatus, "částečně uhrazeno");
assert.equal(manualOnly.contractedDisplayValue, "ANO");

// Žádná platba
const none = calculateJobPaymentSummary({
  job: {
    contractManual: {
      isContracted: true,
      totalPriceGross: 4400400,
      requiredDepositGross: 200000,
    },
  },
});
assert.equal(none.totalPaidGross, 0);
assert.equal(none.remainingToPayGross, 4400400);
assert.equal(none.depositStatus, "nezaplaceno");
assert.equal(none.jobPaymentStatus, "nezaplaceno");

// Plně zaplaceno
const full = calculateJobPaymentSummary({
  job: {
    paidAmountGross: 4400400,
    contractManual: { isContracted: true, totalPriceGross: 4400400 },
  },
});
assert.equal(full.remainingToPayGross, 0);
assert.equal(full.jobPaymentStatus, "zaplaceno");
assert.equal(full.depositStatus, "zaplaceno");

// Záloha splněna, zakázka ne — stav zálohy musí být částečně uhrazeno
const depositOnly = calculateJobPaymentSummary({
  job: {
    contractManual: {
      isContracted: true,
      totalPriceGross: 4400400,
      requiredDepositGross: 200000,
      paidDepositGross: 200000,
    },
  },
});
assert.equal(depositOnly.depositStatus, "částečně uhrazeno");
assert.notEqual(depositOnly.depositStatus, "zaplaceno");

console.log("OK: testy job-payment-summary prošly.");
