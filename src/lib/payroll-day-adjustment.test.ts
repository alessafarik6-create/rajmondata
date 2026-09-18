import assert from "node:assert/strict";
import {
  directionAndFieldsFromAdjustmentMinutes,
  parsePayrollAdjustmentMinutes,
} from "./payroll-day-adjustment";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("+1 h 10 min add => +70", () => {
  const r = parsePayrollAdjustmentMinutes("+1", "10", "add");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.minutes, 70);
});

test("-1 h subtract => -60", () => {
  const r = parsePayrollAdjustmentMinutes("1", "0", "subtract");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.minutes, -60);
});

test("-1 h 10 min subtract => -70", () => {
  const r = parsePayrollAdjustmentMinutes("1", "10", "subtract");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.minutes, -70);
});

test("invalid minutes", () => {
  const r = parsePayrollAdjustmentMinutes("1", "60", "add");
  assert.equal(r.ok, false);
});

test("round-trip -70", () => {
  const f = directionAndFieldsFromAdjustmentMinutes(-70);
  assert.equal(f.direction, "subtract");
  assert.equal(f.hours, "1");
  assert.equal(f.minutes, "10");
});
