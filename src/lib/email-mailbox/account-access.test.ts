import assert from "node:assert/strict";
import {
  messageBelongsToUser,
  personalMailboxVisibleToOwnerOnly,
  resolveAccountOwnerUserId,
  resolveAccountType,
  sharedMailboxAllows,
} from "@/lib/email-mailbox/account-access";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

function testPersonalOwnerIsolation() {
  const accountA = {
    userId: "user-a",
    createdByUserId: "user-a",
    accountType: "PERSONAL" as const,
  };
  assert.equal(personalMailboxVisibleToOwnerOnly(accountA, "user-a"), true);
  assert.equal(personalMailboxVisibleToOwnerOnly(accountA, "user-b"), false);
}

function testLegacyMigrationOwner() {
  const legacy = {
    userId: null,
    createdByUserId: "owner-1",
    accountType: null,
  };
  assert.equal(resolveAccountOwnerUserId(legacy as never), "owner-1");
  assert.equal(resolveAccountType(legacy as never), "PERSONAL");
}

function testMessageFilterByAccessibleAccounts() {
  const ids = new Set(["acc-a"]);
  const msg: EmailMessageDoc = {
    organizationId: "org",
    emailAccountId: "acc-a",
    ownerUserId: "user-a",
    from: "a@x.cz",
    to: [],
    subject: "s",
    direction: "inbound",
    folder: "inbox",
  };
  assert.equal(messageBelongsToUser(msg, "user-a", ids), true);
  assert.equal(messageBelongsToUser(msg, "user-b", new Set(["acc-b"])), false);
}

function testSharedMailboxPermissions() {
  assert.equal(sharedMailboxAllows("READ", "read"), true);
  assert.equal(sharedMailboxAllows("READ", "write"), false);
  assert.equal(sharedMailboxAllows("WRITE", "write"), true);
  assert.equal(sharedMailboxAllows(null, "read"), false);
}

function testUserBCannotSeeUserAAccountInSet() {
  const userBAccessible = new Set<string>();
  const msg: EmailMessageDoc = {
    organizationId: "org",
    emailAccountId: "acc-user-a",
    ownerUserId: "user-a",
    from: "a@firma.cz",
    to: [],
    subject: "tajné",
    direction: "inbound",
    folder: "inbox",
  };
  assert.equal(messageBelongsToUser(msg, "user-b", userBAccessible), false);
}

function testSharedReadMemberSeesMessagesOnSharedAccount() {
  const sharedIds = new Set(["info-box"]);
  const msg: EmailMessageDoc = {
    organizationId: "org",
    emailAccountId: "info-box",
    ownerUserId: "admin-owner",
    from: "client@x.cz",
    to: [],
    subject: "info",
    direction: "inbound",
    folder: "inbox",
  };
  assert.equal(messageBelongsToUser(msg, "member-user", sharedIds), true);
}

function run() {
  testPersonalOwnerIsolation();
  testLegacyMigrationOwner();
  testMessageFilterByAccessibleAccounts();
  testSharedMailboxPermissions();
  testUserBCannotSeeUserAAccountInSet();
  testSharedReadMemberSeesMessagesOnSharedAccount();
  console.log("email-mailbox account-access tests: OK");
}

run();
