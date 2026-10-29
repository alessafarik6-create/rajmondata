import assert from "node:assert/strict";
import { buildJobAssignmentMessageText } from "@/lib/chat/chat-work-intent-notify-message";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("buildJobAssignmentMessageText includes job fields", () => {
  const text = buildJobAssignmentMessageText({
    jobName: "Montáž pergoly Novák",
    customerName: "Jan Novák",
    startDate: "2026-12-02",
    endDate: "2026-12-06",
    note: "Připravit materiál",
    assignerLabel: "Administrátor",
  });
  assert.match(text, /NOVÁ ZAKÁZKA/);
  assert.match(text, /Montáž pergoly Novák/);
  assert.match(text, /Pokyny: Připravit materiál/);
  assert.match(text, /Přiřadil: Administrátor/);
});
