import assert from "node:assert/strict";
import { parseEmployeePortalRole } from "./employee-portal-role";
import { userPortalRoleForEmployeeDocRole } from "./employee-organization";

/** Logika priority bez Firestore — musí odpovídat resolveEmployeeRecordForCaller. */
function pickEmployeeDocId(input: {
  uid: string;
  usersEmployeeId: string | null;
  byAuthId: string | null;
  byAuthAuthUserId: string | null;
  usersDocAuthUserId: string | null;
}): "auth" | "users" | null {
  if (input.byAuthId && input.byAuthAuthUserId === input.uid) return "auth";
  if (
    input.usersEmployeeId &&
    (!input.usersDocAuthUserId || input.usersDocAuthUserId === input.uid)
  ) {
    return "users";
  }
  if (input.byAuthId) return "auth";
  return null;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("authUserId document wins over stale users.employeeId", () => {
  assert.equal(
    pickEmployeeDocId({
      uid: "uid-fanda",
      usersEmployeeId: "old-doc",
      usersDocAuthUserId: "uid-fanda",
      byAuthId: "canonical-doc",
      byAuthAuthUserId: "uid-fanda",
    }),
    "auth"
  );
});

test("users.employeeId used when authUserId on doc matches uid", () => {
  assert.equal(
    pickEmployeeDocId({
      uid: "u1",
      usersEmployeeId: "e1",
      usersDocAuthUserId: "u1",
      byAuthId: null,
      byAuthAuthUserId: null,
    }),
    "users"
  );
});

test("manager org role maps to users.role manager for sync", () => {
  assert.equal(userPortalRoleForEmployeeDocRole(parseEmployeePortalRole("manager")), "manager");
});
