/**
 * Ruční test logiky exportu zesmluvněných zakázek.
 * Spuštění: node scripts/test-contracted-jobs-export.mjs
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
      raw.paidDepositGross != null && Number.isFinite(Number(raw.paidDepositGross))
        ? roundMoney2(Number(raw.paidDepositGross))
        : null,
    requiredDepositGross:
      raw.requiredDepositGross != null &&
      Number.isFinite(Number(raw.requiredDepositGross))
        ? roundMoney2(Number(raw.requiredDepositGross))
        : null,
  };
}

function isJobManuallyContracted(job) {
  return parseJobContractManual(job).isContracted === true;
}

function sumTaxReceiptsForAdvance(invoices, advanceId) {
  let s = 0;
  for (const inv of invoices) {
    if (inv.type !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    if (String(inv.relatedInvoiceId ?? "").trim() !== advanceId) continue;
    s = roundMoney2(s + (Number(inv.amountGross) || 0));
  }
  return s;
}

function computeJobDepositAggregation(job, invoices) {
  const manualData = parseJobContractManual(job);
  const manualDepositGross = roundMoney2(
    Math.max(0, Number(manualData.paidDepositGross) || 0)
  );
  const advances = invoices.filter((i) => i.type === JOB_INVOICE_TYPES.ADVANCE);
  const advanceIds = new Set(advances.map((a) => a.id).filter(Boolean));
  let paymentsDepositGross = 0;
  for (const inv of invoices) {
    if (inv.type !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    const gross = roundMoney2(Number(inv.amountGross) || 0);
    if (gross <= 0) continue;
    const related = String(inv.relatedInvoiceId ?? "").trim();
    if (related && advanceIds.has(related)) {
      paymentsDepositGross = roundMoney2(paymentsDepositGross + gross);
    }
  }
  for (const adv of advances) {
    const aid = String(adv.id ?? "").trim();
    if (!aid) continue;
    const cap = roundMoney2(Number(adv.amountGross) || 0);
    const paidField = roundMoney2(Number(adv.paidGrossReceived) || 0);
    if (paidField <= 0.009) continue;
    const receiptSum = sumTaxReceiptsForAdvance(invoices, aid);
    const gap = roundMoney2(paidField - receiptSum);
    if (gap <= 0.009) continue;
    const add =
      cap > 0 ? Math.min(gap, Math.max(0, roundMoney2(cap - receiptSum))) : gap;
    paymentsDepositGross = roundMoney2(paymentsDepositGross + add);
  }
  return {
    manualDepositGross,
    paymentsDepositGross,
    totalDepositPaidGross: roundMoney2(manualDepositGross + paymentsDepositGross),
  };
}

function resolveDepositPaymentStatus(required, received) {
  if (required <= 0.009) return "—";
  if (received <= 0.009) return "nezaplaceno";
  if (received >= required - 0.01) return "zaplaceno";
  return "částečně zaplaceno";
}

// ručně zesmluvněná bez portálové smlouvy
assert.equal(
  isJobManuallyContracted({ contractManual: { isContracted: true } }),
  true
);

// ruční záloha + platby
const jobManual = { contractManual: { paidDepositGross: 25000 } };
const invPay = [
  { id: "zf1", type: JOB_INVOICE_TYPES.ADVANCE, amountGross: 100000, paidGrossReceived: 50000 },
  {
    id: "dd1",
    type: JOB_INVOICE_TYPES.TAX_RECEIPT,
    relatedInvoiceId: "zf1",
    amountGross: 50000,
  },
];
const agg = computeJobDepositAggregation(jobManual, invPay);
assert.equal(agg.manualDepositGross, 25000);
assert.equal(agg.paymentsDepositGross, 50000);
assert.equal(agg.totalDepositPaidGross, 75000);

// bez dvojího započtení: paidGrossReceived = součet DD
const aggNoDouble = computeJobDepositAggregation({}, invPay);
assert.equal(aggNoDouble.paymentsDepositGross, 50000);

// paidGrossReceived vyšší než DD — doplatek
const invGap = [
  { id: "zf2", type: JOB_INVOICE_TYPES.ADVANCE, amountGross: 100000, paidGrossReceived: 80000 },
  {
    id: "dd2",
    type: JOB_INVOICE_TYPES.TAX_RECEIPT,
    relatedInvoiceId: "zf2",
    amountGross: 50000,
  },
];
const aggGap = computeJobDepositAggregation({}, invGap);
assert.equal(aggGap.paymentsDepositGross, 80000);

// stavy úhrady
assert.equal(resolveDepositPaymentStatus(100000, 0), "nezaplaceno");
assert.equal(resolveDepositPaymentStatus(100000, 40000), "částečně zaplaceno");
assert.equal(resolveDepositPaymentStatus(100000, 100000), "zaplaceno");

console.log("OK: všechny testy contracted-jobs-export prošly.");
