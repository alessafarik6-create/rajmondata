import assert from "node:assert/strict";
import {
  computeManualAttendanceWorkedMinutes,
  resolveDayPayrollWorkedMinutes,
} from "./manual-attendance-payout";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("manual 07:00-16:00 break 30 => 8.5h", () => {
  const r = computeManualAttendanceWorkedMinutes("07:00", "16:00", 30);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.workedMinutes, 510);
});

test("terminal 8h + adj +60 => 9h", () => {
  const r = resolveDayPayrollWorkedMinutes({
    terminalWorkedH: 8,
    terminalIncomplete: false,
    manualWorkedMinutes: null,
    adjustmentMinutes: 60,
  });
  assert.equal(r.finalMinutes, 540);
});

test("manual override replaces terminal base", () => {
  const r = resolveDayPayrollWorkedMinutes({
    terminalWorkedH: 8,
    terminalIncomplete: false,
    manualWorkedMinutes: 507,
    adjustmentMinutes: 0,
  });
  assert.equal(r.baseMinutes, 507);
  assert.equal(r.finalMinutes, 507);
});

test("incomplete terminal + 18h adj pays", () => {
  const r = resolveDayPayrollWorkedMinutes({
    terminalWorkedH: null,
    terminalIncomplete: true,
    manualWorkedMinutes: null,
    adjustmentMinutes: 18 * 60,
  });
  assert.equal(r.finalMinutes, 1080);
  assert.equal(r.blockPayForIncompleteTerminal, false);
});

test("adj -30 on 8h => 7.5h", () => {
  const r = resolveDayPayrollWorkedMinutes({
    terminalWorkedH: 8,
    terminalIncomplete: false,
    manualWorkedMinutes: null,
    adjustmentMinutes: -30,
  });
  assert.equal(r.finalMinutes, 450);
});
