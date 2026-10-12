import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  localDateTimeFromParts,
  resolveLeadReminderQuickPreset,
} from "@/lib/leads/lead-reminder-datetime";

describe("lead-reminder-datetime", () => {
  it("parses local date time parts", () => {
    const d = localDateTimeFromParts("2026-10-12", 11, 30);
    assert.ok(d);
    assert.equal(d!.getHours(), 11);
    assert.equal(d!.getMinutes(), 30);
  });

  it("quick preset +15m is in the future", () => {
    const now = new Date("2026-10-12T09:00:00");
    const d = resolveLeadReminderQuickPreset("15m", now);
    assert.equal(d.getTime(), now.getTime() + 15 * 60 * 1000);
  });
});
