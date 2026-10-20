import { computeLineDiff, computeProfileTotalMm } from "@/lib/warehouse-inventory-diff";

const m = computeLineDiff(150, 143);
if (m.status !== "shortage" || m.diff !== -7) {
  throw new Error("shortage diff failed");
}

const unset = computeLineDiff(10, null);
if (unset.status !== "unset" || unset.diff !== null) {
  throw new Error("unset must not be zero");
}

const match = computeLineDiff(5, 5);
if (match.status !== "match") throw new Error("match failed");

const mm = computeProfileTotalMm({
  fullBarCount: 8,
  barLengthMm: 6500,
  partialLengthsMm: [1200, 800, 400, 300],
});
if (mm !== 8 * 6500 + 2700) throw new Error("profile mm total failed");

console.log("[warehouse-inventory-diff.test] OK");
