import assert from "node:assert/strict";
import {
  buildAccountantPermissionPreset,
  canAccessPortalModule,
  resolveEffectivePortalPermissions,
} from "../portal-permissions";
import { bankTransactionRawHash, resolveBankTransactionDocId } from "./transaction-id";
import { pickAutoMatch, suggestBankTransactionMatches } from "./matching";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("accountant preset bank none", () => {
  const p = buildAccountantPermissionPreset();
  assert.equal(p.bank, "none");
  assert.equal(p.finance, "read");
});

test("employee finance read bank none", () => {
  const p = resolveEffectivePortalPermissions({
    role: "employee",
    employeeDoc: { portalModulePermissions: { bank: "none", finance: "read" } },
  });
  assert.equal(canAccessPortalModule(p, "bank", "read"), false);
  assert.equal(canAccessPortalModule(p, "finance", "read"), true);
});

test("owner bank write", () => {
  const p = resolveEffectivePortalPermissions({ role: "owner" });
  assert.equal(canAccessPortalModule(p, "bank", "write"), true);
});

test("transaction idempotent hash", () => {
  const input = {
    organizationId: "org1",
    accountId: "acc1",
    bookingDate: "2026-10-03",
    amount: 1000,
    currency: "CZK",
    variableSymbol: "123",
  };
  const a = resolveBankTransactionDocId(input);
  const b = resolveBankTransactionDocId(input);
  assert.equal(a.rawHash, b.rawHash);
  assert.notEqual(
    bankTransactionRawHash({ ...input, amount: 100 }),
    bankTransactionRawHash({ ...input, amount: 200 })
  );
});

test("matching VS + amount", () => {
  const todayIso = "2026-10-03";
  const suggestions = suggestBankTransactionMatches(
    {
      direction: "incoming",
      amount: 180_000,
      currency: "CZK",
      variableSymbol: "2026015",
      bookingDate: todayIso,
    },
    {
      todayIso,
      issuedInvoices: [
        {
          id: "inv1",
          invoiceNumber: "FV-1",
          variableSymbol: "2026015",
          amountGross: 180_000,
          status: "sent",
        },
      ],
      receivedDocuments: [],
    }
  );
  assert.ok(suggestions.length > 0);
  assert.equal(pickAutoMatch(suggestions)?.targetId, "inv1");
});
