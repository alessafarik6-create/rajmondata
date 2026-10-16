import assert from "node:assert/strict";
import {
  evaluateNotificationDelivery,
  mergeNotificationPreferences,
  shouldSendModuleEmailToUser,
} from "./preferences";
import type { CreateNotificationInput } from "./types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const baseInput = (): CreateNotificationInput => ({
  organizationId: "c1",
  recipientUserId: "u1",
  type: "INQUIRY_CREATED",
  title: "Nová poptávka",
  body: "Test",
});

test("vypnuté Poptávky — žádný in-app ani push", () => {
  const prefs = mergeNotificationPreferences({ inquiries: false, pushEnabled: true });
  const d = evaluateNotificationDelivery(prefs, baseInput());
  assert.equal(d.inApp, false);
  assert.equal(d.push, false);
});

test("zapnuté Poptávky — in-app i push", () => {
  const prefs = mergeNotificationPreferences({ inquiries: true, pushEnabled: true });
  const d = evaluateNotificationDelivery(prefs, baseInput());
  assert.equal(d.inApp, true);
  assert.equal(d.push, true);
});

test("modulový e-mail leads respektuje inquiries", () => {
  const prefs = mergeNotificationPreferences({ emailEnabled: true, inquiries: false });
  assert.equal(shouldSendModuleEmailToUser(prefs, "leads"), false);
  const on = mergeNotificationPreferences({ emailEnabled: true, inquiries: true });
  assert.equal(shouldSendModuleEmailToUser(on, "leads"), true);
});
