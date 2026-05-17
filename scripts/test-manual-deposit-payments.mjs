/**
 * Test ručních plateb zálohy (součet, export štítky).
 * node scripts/test-manual-deposit-payments.mjs
 */

import assert from "node:assert/strict";

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function formatCs(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function formatKc(n) {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

function resolveManualDepositGross(manual) {
  const payments = manual.manualDepositPayments ?? [];
  if (payments.length > 0) {
    return roundMoney2(payments.reduce((s, p) => s + p.amountGross, 0));
  }
  return roundMoney2(Number(manual.paidDepositGross) || 0);
}

function buildLabels(payments) {
  return payments
    .filter((p) => p.amountGross > 0)
    .map((p) => {
      const note = p.note?.trim();
      const base = `${formatCs(p.paidAt)} (${formatKc(p.amountGross)})`;
      return note ? `${base} · ${note}` : base;
    });
}

const manual = {
  manualDepositPayments: [
    { id: "1", paidAt: "2024-03-10", amountGross: 100000, note: null },
    { id: "2", paidAt: "2024-03-25", amountGross: 100000, note: null },
  ],
};

const total = resolveManualDepositGross(manual);
assert.equal(total, 200000);

const labels = buildLabels(manual.manualDepositPayments);
assert.equal(labels.length, 2);
assert.match(labels[0], /10\.03\.2024 \(100.000 Kč\)/);
assert.match(labels[1], /25\.03\.2024 \(100.000 Kč\)/);

const price = 4400400;
const remaining = price - total;
assert.equal(remaining, 4200400);

console.log("OK: testy ručních plateb zálohy prošly.");
