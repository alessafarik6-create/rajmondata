import {
  convertToIban,
  czIbanToDomesticAccount,
  enrichResolvedBankSnapshot,
  formatBankBlockPlainLines,
  validateIbanMod97,
} from "@/lib/invoice-billing-meta";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const iban = convertToIban("2192111088", "5500");
assert(iban != null && validateIbanMod97(iban), "iban from czech account");

const back = czIbanToDomesticAccount(iban!);
assert(back != null && back.bankCode === "5500", "iban back to bank code");

const snap = enrichResolvedBankSnapshot({
  bankAccountId: "a1",
  bankAccountNumber: null,
  bankCode: null,
  iban: iban!,
  swift: "RZBCCZPP",
  displayPrimary: "—",
  accountName: "Raiffeisenbank",
  source: "organization",
});

assert(snap.bankAccountNumber != null && snap.bankCode === "5500", "enrich domestic from iban");

const block = formatBankBlockPlainLines(snap, {
  variableSymbol: "2026058",
  amountGross: 500_000,
  dueDate: "2026-11-13",
  currency: "CZK",
});

assert(block.includes("Číslo účtu:"), "block has czech account");
assert(block.includes("IBAN:"), "block has iban");
assert(block.includes("SWIFT/BIC:"), "block has swift");
assert(block.includes("Variabilní symbol: 2026058"), "block has vs");
assert(block.includes("500") && block.includes("Kč"), "block has amount");
assert(block.includes("Splatnost: 13. 11. 2026"), "block has due date");

console.log("invoice-billing-meta.test.ts OK");
