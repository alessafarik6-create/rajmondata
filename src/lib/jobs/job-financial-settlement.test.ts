import assert from "node:assert";
import {
  computeJobSettlement,
  resolveJobCurrentValue,
} from "./job-financial-settlement";
import {
  EXTRA_WORK_STATUSES,
  WORK_BUDGET_ITEM_TYPES,
  type JobWorkBudgetItemDoc,
} from "@/lib/work-budget-types";
import type { JobBudgetBreakdown } from "@/lib/vat-calculations";

const jobBudget: JobBudgetBreakdown = {
  vatRate: 21,
  budgetType: "net",
  budgetInput: 107_624,
  budgetNet: 107_624,
  budgetVat: 22_601.04,
  budgetGross: 130_225.04,
};

function extraItem(): JobWorkBudgetItemDoc {
  return {
    id: "ex1",
    companyId: "c1",
    jobId: "j1",
    sortOrder: 1,
    title: "Vícepráce",
    description: "",
    quantity: 1,
    unit: "ks",
    unitPriceNet: 10_000,
    vatRate: 21,
    amountNet: 10_000,
    vatAmount: 2_100,
    amountGross: 12_100,
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.APPROVED,
    done: true,
    doneAt: null,
    note: null,
    invoiced: false,
    invoicedAt: null,
    linkedInvoiceId: null,
  };
}

{
  const cv = resolveJobCurrentValue({
    jobBudget,
    workBudgetItems: [extraItem()],
  });
  assert.ok(Math.abs(cv.current.gross - 142_325.04) < 0.1);
  assert.ok(Math.abs(cv.extraWorkApproved.gross - 12_100) < 0.01);
}

{
  const settlement = computeJobSettlement({
    jobBudget,
    workBudgetItems: [extraItem()],
    advanceInvoices: [
      {
        id: "zf1",
        type: "advance_invoice",
        invoiceNumber: "ZF-1",
        amountGross: 88_553,
        amountNet: 73_184.3,
        vatAmount: 15_368.7,
        vatRate: 21,
        paidGrossReceived: 88_553,
      },
    ],
    contractFallback: null,
  });
  assert.ok(Math.abs(settlement.totalContractGross - 142_325.04) < 0.15);
  assert.ok(Math.abs(settlement.totalAdvancePaid - 88_553) < 0.01);
  assert.ok(Math.abs(settlement.amountToPay - 53_772.04) < 0.15);
}

{
  const withoutExtras = computeJobSettlement({
    jobBudget,
    workBudgetItems: [],
    advanceInvoices: [
      {
        id: "zf1",
        type: "advance_invoice",
        paidGrossReceived: 88_553,
        amountGross: 88_553,
        vatRate: 21,
      },
    ],
    contractFallback: null,
  });
  assert.ok(Math.abs(withoutExtras.amountToPay - 41_672.04) < 0.15);
}

{
  const twice = computeJobSettlement({
    jobBudget,
    workBudgetItems: [extraItem()],
    advanceInvoices: [
      {
        id: "zf1",
        type: "advance_invoice",
        paidGrossReceived: 88_553,
        amountGross: 88_553,
        vatRate: 21,
      },
    ],
    allJobInvoices: [
      {
        id: "fa1",
        type: "portal_manual_invoice",
        workBudgetSource: true,
        amountGross: 30_000,
      },
    ],
    contractFallback: null,
  });
  assert.ok(twice.alreadyInvoicedGross === 30_000);
  assert.ok(Math.abs(twice.amountToPay - (53_772.04 - 30_000)) < 0.2);
}

console.log("job-financial-settlement.test.ts: OK");
