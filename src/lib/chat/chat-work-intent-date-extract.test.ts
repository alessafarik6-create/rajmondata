import assert from "node:assert/strict";
import {
  extractDateRangesFromText,
  findOverlappingRangeIds,
} from "@/lib/chat/chat-work-intent-date-extract";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const sample = `
Rezervace prosinec
02.12 - 06.12
11.12 - 13.12
18.12 - 21.12
23.12 - 27.12
27.12 - 01.01
`;

test("extracts five date ranges from reservation screenshot text", () => {
  const ref = new Date("2026-10-25T10:00:00Z");
  const ranges = extractDateRangesFromText(sample, ref);
  assert.equal(ranges.length, 5);
  assert.equal(ranges[0]!.startDate, "2026-12-02");
  assert.equal(ranges[0]!.endDate, "2026-12-06");
  assert.equal(ranges[4]!.startDate, "2026-12-27");
  assert.equal(ranges[4]!.endDate, "2027-01-01");
  assert.equal(ranges[0]!.yearNeedsConfirmation, true);
});

test("detects overlapping ranges", () => {
  const ids = findOverlappingRangeIds([
    { id: "a", startDate: "2026-12-23", endDate: "2026-12-27" },
    { id: "b", startDate: "2026-12-27", endDate: "2027-01-01" },
  ]);
  assert.ok(ids.includes("a"));
  assert.ok(ids.includes("b"));
});
