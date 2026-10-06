import assert from "node:assert/strict";
import {
  evaluateProductionAttendanceEligibility,
  productionEndReasonForTariffMeta,
} from "./attendance-eligibility";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("not clocked in — empty events", () => {
  const r = evaluateProductionAttendanceEligibility({
    attendanceEvents: [],
    openSegmentSourceType: null,
  });
  assert.equal(r.canStartProduction, false);
  assert.equal(r.status, "NOT_CLOCKED_IN");
});

test("working — check_in only", () => {
  const r = evaluateProductionAttendanceEligibility({
    attendanceEvents: [{ type: "check_in", timestampMs: 1 }],
    openSegmentSourceType: null,
  });
  assert.equal(r.canStartProduction, true);
  assert.equal(r.status, "WORKING");
});

test("blocked — open tariff segment", () => {
  const r = evaluateProductionAttendanceEligibility({
    attendanceEvents: [{ type: "check_in", timestampMs: 1 }],
    openSegmentSourceType: "tariff",
  });
  assert.equal(r.canStartProduction, false);
  assert.equal(r.status, "NON_WORKING_TARIFF");
});

test("blocked — break_start without end", () => {
  const r = evaluateProductionAttendanceEligibility({
    attendanceEvents: [
      { type: "check_in", timestampMs: 1 },
      { type: "break_start", timestampMs: 2 },
    ],
    openSegmentSourceType: null,
  });
  assert.equal(r.canStartProduction, false);
  assert.equal(r.status, "ON_BREAK");
});

test("working — after break_end", () => {
  const r = evaluateProductionAttendanceEligibility({
    attendanceEvents: [
      { type: "check_in", timestampMs: 1 },
      { type: "break_start", timestampMs: 2 },
      { type: "break_end", timestampMs: 3 },
    ],
    openSegmentSourceType: null,
  });
  assert.equal(r.canStartProduction, true);
});

test("clocked out", () => {
  const r = evaluateProductionAttendanceEligibility({
    attendanceEvents: [
      { type: "check_in", timestampMs: 1 },
      { type: "check_out", timestampMs: 9 },
    ],
    openSegmentSourceType: null,
  });
  assert.equal(r.canStartProduction, false);
  assert.equal(r.status, "CLOCKED_OUT");
});

test("tariff oběd => attendance_lunch", () => {
  assert.equal(
    productionEndReasonForTariffMeta({ name: "Oběd", category: null }),
    "attendance_lunch"
  );
  assert.equal(
    productionEndReasonForTariffMeta({ name: "Pauza", category: null }),
    "attendance_break"
  );
});
