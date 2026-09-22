import assert from "node:assert/strict";
import {
  allocationFormRowsToDomain,
  allocationInputToGrossCzk,
  documentAllocationTotalsCzk,
  grossCzkToDisplayInput,
  switchAllocationFormBasis,
} from "./company-document-allocation-vat";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const doc21 = {
  castkaCZK: 121000,
  amountNetCZK: 100000,
  vatAmountCZK: 21000,
  vatRate: 21,
};

test("totals from document", () => {
  const t = documentAllocationTotalsCzk(doc21);
  assert.equal(t.gross, 121000);
  assert.equal(t.net, 100000);
  assert.equal(t.vat, 21000);
});

test("net input to gross", () => {
  const t = documentAllocationTotalsCzk(doc21);
  assert.equal(allocationInputToGrossCzk(10000, "net", t), 12100);
  assert.equal(allocationInputToGrossCzk(12100, "gross", t), 12100);
});

test("basis switch keeps gross", () => {
  const t = documentAllocationTotalsCzk(doc21);
  const rows = [
    {
      id: "a",
      kind: "job" as const,
      jobId: "j1",
      amount: "60500",
      percent: "",
      note: "",
    },
  ];
  const gross = allocationFormRowsToDomain({
    mode: "amount",
    inputBasis: "gross",
    totals: t,
    rows,
  })[0].amount;
  const asNet = switchAllocationFormBasis(rows, "gross", "net", t, "amount");
  const back = allocationFormRowsToDomain({
    mode: "amount",
    inputBasis: "net",
    totals: t,
    rows: asNet,
  })[0].amount;
  assert.equal(back, gross);
  assert.ok(Math.abs(Number(asNet[0].amount) - 50000) < 0.02);
});

test("zero vat", () => {
  const doc0 = {
    castkaCZK: 60000,
    amountNetCZK: 60000,
    vatAmountCZK: 0,
    vatRate: 0,
  };
  const t = documentAllocationTotalsCzk(doc0);
  assert.equal(grossCzkToDisplayInput(30000, "net", t), 30000);
  assert.equal(allocationInputToGrossCzk(30000, "net", t), 30000);
});
