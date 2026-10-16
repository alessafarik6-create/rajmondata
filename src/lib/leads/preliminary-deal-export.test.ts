import {
  companyDocToPreliminaryDealProfile,
  formatPreliminaryDealsPeriodLabel,
  exportPreliminaryDealsListPdfBuffer,
  exportSinglePreliminaryDealPdfBuffer,
} from "@/lib/leads/preliminary-deal-export";
import type { PreliminaryDealExportRow } from "@/lib/leads/preliminary-deal-export";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const profile = companyDocToPreliminaryDealProfile({
  companyName: "Test s.r.o.",
  ico: "12345678",
  dic: "CZ12345678",
  companyAddressStreetAndNumber: "Hlavní 1",
  companyAddressCity: "Praha",
  companyAddressPostalCode: "11000",
  email: "info@test.cz",
  phone: "+420111222333",
});

assert(profile.name === "Test s.r.o.", "company name");
assert(profile.ico === "12345678", "ico");
assert(formatPreliminaryDealsPeriodLabel("2026-01-01", "2026-12-31").includes("2026"), "period");

const row: PreliminaryDealExportRow = {
  id: "x1",
  companyId: "c1",
  title: "Montáž oken",
  description: "Popis práce s diakritikou: ščřžýáíé",
  priceAmount: 185000,
  priceVatMode: "with_vat",
  status: "predjednano",
  customerId: null,
  customerName: "Jan Novák",
  customerPhone: "777",
  customerEmail: "jan@example.cz",
  expectedCompletionDate: "2026-11-15",
  expectedConfirmationDate: null,
  note: "Poznámka",
  responsibleEmployeeId: "e1",
  responsibleEmployeeName: "Jan Novák",
  sourceLeadId: null,
  convertedJobId: null,
  convertedAt: null,
  attachments: [],
  createdBy: "u1",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: null,
  updatedBy: null,
};

async function runPdfTests() {
  const single = await exportSinglePreliminaryDealPdfBuffer(row, profile);
  assert(single.length > 8000, "single pdf size");
  assert(single.subarray(0, 4).toString() === "%PDF", "single pdf header");

  const list = await exportPreliminaryDealsListPdfBuffer([row], profile, "Test období");
  assert(list.length > 8000, "list pdf size");
  assert(list.subarray(0, 4).toString() === "%PDF", "list pdf header");

  const many = Array.from({ length: 25 }, (_, i) => ({
    ...row,
    id: `x${i}`,
    title: `Zakázka ${i} — dlouhý název s diakritikou ščřž`,
    description: `Popis ${i}`,
  }));
  const listMany = await exportPreliminaryDealsListPdfBuffer(
    many,
    profile,
    "Test",
    "Stav: predjednano"
  );
  assert(listMany.length > list.length, "many rows pdf larger");
}

runPdfTests()
  .then(() => console.log("ok preliminary-deal-export pdf"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
