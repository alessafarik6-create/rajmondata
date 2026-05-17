/**
 * Regrese: spodní souhrn PDF nesmí obsahovat „Součet požadovaných záloh“.
 * node scripts/test-contracted-jobs-pdf-summary.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfSrc = readFileSync(
  join(root, "src/lib/pdf/exportContractedJobsToPdf.ts"),
  "utf8"
);

const forbidden = [
  "Součet požadovaných záloh",
  "soucet_pozadovanych_zaloh",
  "requestedDeposits",
  "totalRequestedDeposits",
  "requestedDepositTotal",
];

const summaryFn = pdfSrc.match(
  /export function buildContractedJobsPdfSummaryLines[\s\S]*?^}/m
)?.[0];
assert.ok(summaryFn, "buildContractedJobsPdfSummaryLines must exist");

for (const text of forbidden) {
  assert.equal(
    summaryFn.includes(text),
    false,
    `PDF summary builder must not contain: ${text}`
  );
}

assert.match(
  pdfSrc,
  /const summaryLines = buildContractedJobsPdfSummaryLines\(summary\)/,
  "export must use buildContractedJobsPdfSummaryLines"
);

assert.doesNotMatch(
  pdfSrc,
  /totalRequiredDepositGross/,
  "PDF export must not reference totalRequiredDepositGross in summary"
);

function buildLines(summary) {
  const formatMoneyKc = (n) => `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
  return [
    `Počet zesmluvněných zakázek: ${summary.jobCount}`,
    `Součet cen zakázek: ${formatMoneyKc(summary.totalPriceGross)}`,
    `Součet celkem zaplaceno: ${formatMoneyKc(summary.totalReceivedDepositGross)}`,
    `Součet zbývá doplatit: ${formatMoneyKc(summary.totalRemainingToPayGross)}`,
  ];
}

const lines = buildLines({
  jobCount: 2,
  totalPriceGross: 1000,
  totalReceivedDepositGross: 200,
  totalRemainingToPayGross: 800,
});

assert.equal(lines.length, 4);
for (const f of forbidden) {
  assert.ok(!lines.some((l) => l.includes(f)), `generated line contains ${f}`);
}

console.log("OK: PDF souhrn bez řádku požadovaných záloh.");
