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

function filterBillingWorkContracts(contracts) {
  return contracts.filter((c) => {
    if (c.isTemplate === true) return false;
    const ct = String(c.contractType ?? "").trim();
    return !ct || ct === "smlouva_o_dilo" || ct === "contract_document";
  });
}

function contractHasSavedBody(c) {
  if (String(c.pdfHtml ?? "").trim()) return true;
  if (c.pdfSavedAt != null) return true;
  return (
    String(c.mainContractContent ?? "").trim().length > 0 ||
    String(c.contractHeader ?? "").trim().length > 0
  );
}

function isJobContracted(job, contractsForJob) {
  const status = String(job.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "zesmluvněno") return true;
  const jobNumbers = [job.contractNumber, job.sodNumber]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  if (jobNumbers.length) return true;
  const relevant = filterBillingWorkContracts(contractsForJob);
  if (relevant.some((c) => String(c.contractNumber ?? "").trim())) return true;
  return relevant.some((c) => {
    if (String(c.documentRole ?? "").trim() === "attachment") return false;
    return contractHasSavedBody(c);
  });
}

function aggregateDepositPaymentsFromInvoices(invoices) {
  const advanceIds = new Set();
  for (const inv of invoices) {
    if (inv.type === JOB_INVOICE_TYPES.ADVANCE && inv.id) advanceIds.add(inv.id);
  }
  let receivedDepositGross = 0;
  const paymentDateLabels = [];
  const otherPaymentsLabels = [];
  for (const inv of invoices) {
    if (inv.type !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    const gross = roundMoney2(Number(inv.amountGross) || 0);
    if (gross <= 0) continue;
    const related = String(inv.relatedInvoiceId ?? "").trim();
    if (related && advanceIds.has(related)) {
      receivedDepositGross = roundMoney2(receivedDepositGross + gross);
      paymentDateLabels.push(String(inv.paymentDate ?? gross));
    } else {
      otherPaymentsLabels.push(`other:${gross}`);
    }
  }
  return { receivedDepositGross, paymentDateLabels, otherPaymentsLabels };
}

function resolveDepositPaymentStatus(required, received) {
  if (required <= 0.009) return "—";
  if (received <= 0.009) return "nezaplaceno";
  if (received >= required - 0.01) return "zaplaceno";
  return "částečně zaplaceno";
}

function buildSummary(rows) {
  return rows.reduce(
    (s, r) => ({
      jobCount: s.jobCount + 1,
      totalPriceGross: roundMoney2(s.totalPriceGross + r.totalPriceGross),
      totalRequiredDepositGross: roundMoney2(
        s.totalRequiredDepositGross + r.requiredDepositGross
      ),
      totalReceivedDepositGross: roundMoney2(
        s.totalReceivedDepositGross + r.receivedDepositGross
      ),
      totalDepositRemainingGross: roundMoney2(
        s.totalDepositRemainingGross + r.depositRemainingGross
      ),
    }),
    {
      jobCount: 0,
      totalPriceGross: 0,
      totalRequiredDepositGross: 0,
      totalReceivedDepositGross: 0,
      totalDepositRemainingGross: 0,
    }
  );
}

// 1) bez smlouvy
assert.equal(
  isJobContracted({ status: "nová" }, []),
  false,
  "zakázka bez smlouvy"
);

// 2) zesmluvněná bez platby
const agg0 = aggregateDepositPaymentsFromInvoices([]);
assert.equal(agg0.receivedDepositGross, 0);

// 3) více zálohových plateb
const invMulti = [
  { id: "zf1", type: JOB_INVOICE_TYPES.ADVANCE },
  {
    id: "dd1",
    type: JOB_INVOICE_TYPES.TAX_RECEIPT,
    relatedInvoiceId: "zf1",
    amountGross: 50000,
    paymentDate: "2025-01-10",
  },
  {
    id: "dd2",
    type: JOB_INVOICE_TYPES.TAX_RECEIPT,
    relatedInvoiceId: "zf1",
    amountGross: 30000,
    paymentDate: "2025-02-01",
  },
];
const aggMulti = aggregateDepositPaymentsFromInvoices(invMulti);
assert.equal(aggMulti.receivedDepositGross, 80000, "součet dvou záloh");

// 4) částečně
assert.equal(
  resolveDepositPaymentStatus(100000, 40000),
  "částečně zaplaceno"
);

// 5) plně
assert.equal(resolveDepositPaymentStatus(100000, 100000), "zaplaceno");

// 6) souhrn
const rows = [
  {
    totalPriceGross: 200000,
    requiredDepositGross: 60000,
    receivedDepositGross: 40000,
    depositRemainingGross: 20000,
  },
  {
    totalPriceGross: 100000,
    requiredDepositGross: 30000,
    receivedDepositGross: 30000,
    depositRemainingGross: 0,
  },
];
const sum = buildSummary(rows);
assert.equal(sum.jobCount, 2);
assert.equal(sum.totalPriceGross, 300000);
assert.equal(sum.totalRequiredDepositGross, 90000);
assert.equal(sum.totalReceivedDepositGross, 70000);
assert.equal(sum.totalDepositRemainingGross, 20000);

// zesmluvněná podle čísla SOD
assert.equal(
  isJobContracted({}, [{ id: "c1", contractNumber: "SOD-2025-001" }]),
  true
);

console.log("OK: všechny testy contracted-jobs-export prošly.");
