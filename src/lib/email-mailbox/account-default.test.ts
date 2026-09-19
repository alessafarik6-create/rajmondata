import assert from "node:assert/strict";
import {
  applySingleDefaultChoice,
  isEmailAccountConnected,
  normalizeMailboxEmail,
  pickDefaultAccountId,
} from "@/lib/email-mailbox/account-default";
import type { EmailAccountDoc } from "@/lib/email-mailbox/types";

function acc(partial: Partial<EmailAccountDoc & { id: string }>): EmailAccountDoc & { id: string } {
  return {
    id: partial.id ?? "x",
    organizationId: "org",
    provider: "SEZNAM",
    email: partial.email ?? "a@test.cz",
    status: partial.status ?? "connected",
    imapHost: "x",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "x",
    smtpPort: 465,
    smtpSecure: true,
    userId: partial.userId ?? "user-a",
    accountType: "PERSONAL",
    isDefault: partial.isDefault,
    isActive: partial.isActive,
    ...partial,
  } as EmailAccountDoc & { id: string };
}

function testDefaultSwitch() {
  const accounts = [
    acc({ id: "a1", email: "a1@x.cz", isDefault: true }),
    acc({ id: "a2", email: "a2@x.cz", isDefault: false }),
  ];
  const r = applySingleDefaultChoice(accounts, "a2", "user-a");
  assert.equal(r.defaultId, "a2");
  assert.deepEqual(r.othersClearDefault, ["a1"]);
}

function testPickDefault() {
  const accounts = [
    acc({ id: "a1", isDefault: false }),
    acc({ id: "a2", isDefault: true }),
  ];
  assert.equal(pickDefaultAccountId(accounts), "a2");
}

function testDisconnectedNotSyncable() {
  assert.equal(isEmailAccountConnected(acc({ status: "disconnected" })), false);
  assert.equal(isEmailAccountConnected(acc({ status: "connected", isActive: false })), false);
}

function testNormalizeEmail() {
  assert.equal(normalizeMailboxEmail("  A@Firma.CZ "), "a@firma.cz");
}

function run() {
  testDefaultSwitch();
  testPickDefault();
  testDisconnectedNotSyncable();
  testNormalizeEmail();
  console.log("email-mailbox account-default tests: OK");
}

run();
