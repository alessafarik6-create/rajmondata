/**
 * Test data zesmluvnění v exportu (bez data vytvoření zakázky).
 * node scripts/test-contracted-date-export.mjs
 */

import assert from "node:assert/strict";

function normalizeContractedAtToIso(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))) return s.slice(0, 10);
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.replace(/\s/g, ""));
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function formatCs(iso) {
  const n = normalizeContractedAtToIso(iso);
  if (!n) return "";
  const [y, mo, d] = n.split("-");
  return `${d}.${mo}.${y}`;
}

function resolveContractedDisplayValue(job, isContracted) {
  const m = job.contractManual ?? {};
  const iso = normalizeContractedAtToIso(m.contractedAt);
  const date = iso ? formatCs(iso) : "";
  if (date) return date;
  if (m.isContracted || isContracted) return "ANO";
  return "NE";
}

// Ruční datum 2024, vytvoření zakázky 2026
const row = resolveContractedDisplayValue(
  {
    createdAt: "2026-01-15",
    contractManual: {
      isContracted: true,
      contractedAt: "2024-06-10",
    },
  },
  true
);
assert.equal(row, "10.06.2024");

// Bez data, zesmluvněná
assert.equal(
  resolveContractedDisplayValue(
    { contractManual: { isContracted: true } },
    true
  ),
  "ANO"
);

// Nezesmluvněná
assert.equal(
  resolveContractedDisplayValue({ contractManual: {} }, false),
  "NE"
);

// dd.mm.yyyy vstup
assert.equal(formatCs("15.03.2024"), "15.03.2024");

console.log("OK: testy data zesmluvnění prošly.");
