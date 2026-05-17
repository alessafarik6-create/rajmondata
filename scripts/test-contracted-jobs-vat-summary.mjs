/**
 * Test souhrnu DPH u exportu zesmluvněných zakázek.
 * node scripts/test-contracted-jobs-vat-summary.mjs
 */

import assert from "node:assert/strict";

const DEFAULT_VAT = 21;

function roundMoney2(n) {
  return Math.round(n * 100) / 100;
}

function resolveJobVatRateForExport(job) {
  const raw = job?.vatRate;
  const hasExplicit =
    raw !== undefined &&
    raw !== null &&
    String(raw).trim() !== "" &&
    Number.isFinite(Number(raw));
  if (!hasExplicit) {
    return { effectiveRate: DEFAULT_VAT, summaryGroupKey: "neurceno", title: "Neurčeno", sort: 4 };
  }
  const rate = Number(raw);
  const r = rate === 0 || rate === 12 || rate === 21 ? rate : DEFAULT_VAT;
  return {
    effectiveRate: r,
    summaryGroupKey: r === 12 ? "12" : r === 21 ? "21" : "0",
    title: `DPH ${r} %`,
    sort: r === 12 ? 1 : r === 21 ? 2 : 3,
  };
}

function splitGross(gross, vatRate) {
  const g = roundMoney2(Math.max(0, gross));
  if (g <= 0) return { net: 0, vat: 0, gross: 0 };
  if (vatRate === 0) return { net: g, vat: 0, gross: g };
  const net = roundMoney2(g / (1 + vatRate / 100));
  return { net, vat: roundMoney2(g - net), gross: g };
}

function buildPaidVatGroups(rows) {
  const acc = new Map();
  for (const r of rows) {
    if (r.totalPaidGross <= 0) continue;
    const vat = resolveJobVatRateForExport(r.job);
    const s = splitGross(r.totalPaidGross, vat.effectiveRate);
    const cur = acc.get(vat.summaryGroupKey) ?? {
      title: vat.title,
      sort: vat.sort,
      net: 0,
      vat: 0,
      gross: 0,
    };
    cur.net = roundMoney2(cur.net + s.net);
    cur.vat = roundMoney2(cur.vat + s.vat);
    cur.gross = roundMoney2(cur.gross + s.gross);
    acc.set(vat.summaryGroupKey, cur);
  }
  return [...acc.values()].sort((a, b) => a.sort - b.sort);
}

const rows = [
  { job: { vatRate: 12 }, totalPaidGross: 112000 },
  { job: { vatRate: 21 }, totalPaidGross: 242000 },
  { job: {}, totalPaidGross: 121000 },
];

const groups = buildPaidVatGroups(rows);
const totalPaid = rows.reduce((s, r) => s + r.totalPaidGross, 0);
const groupsGross = groups.reduce((s, g) => s + g.gross, 0);

assert.equal(groups.length, 3);
assert.equal(groups[0].title, "DPH 12 %");
assert.equal(groups[1].title, "DPH 21 %");
assert.equal(groups[2].title, "Neurčeno");
assert.equal(groupsGross, totalPaid);

// 12 %: 112000 gross → net ~100000
assert.ok(Math.abs(groups[0].net - 100000) < 1);
assert.ok(groups[0].vat > 0);

console.log("OK: testy souhrnu DPH prošly.");
