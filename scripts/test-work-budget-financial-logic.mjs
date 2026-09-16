/**
 * Logické testy rozpočtu, víceprací a záloh (bez Firebase).
 * Spuštění: npx --yes tsx scripts/test-work-budget-financial-logic.mjs
 */
import assert from "node:assert/strict";

import { computeWorkBudgetFinancialOverview, applyAdvanceDeductionsToGross } from "../src/lib/work-budget-financial-overview.ts";
import {
  buildWorkBudgetInvoicePreview,
  billableWorkBudgetItems,
  formatWorkBudgetItemInvoiceDescription,
  buildInvoiceLinesFromWorkBudgetItems,
  workBudgetItemsEligibleForInvoice,
  assessWorkBudgetInvoiceRegeneration,
  isWorkBudgetInvoiceStale,
} from "../src/lib/work-budget-invoice.ts";
import {
  EXTRA_WORK_STATUSES,
  WORK_BUDGET_ITEM_TYPES,
} from "../src/lib/work-budget-types.ts";

function item(partial) {
  const qty = partial.quantity ?? 1;
  const unitNet = partial.unitPriceNet ?? partial.amountNet ?? 0;
  const vatRate = partial.vatRate ?? 21;
  const amountNet = partial.amountNet ?? unitNet * qty;
  const vatAmount = partial.vatAmount ?? Math.round(amountNet * vatRate) / 100;
  const amountGross = partial.amountGross ?? amountNet + vatAmount;
  return {
    id: partial.id ?? "i1",
    companyId: "c1",
    jobId: "j1",
    sortOrder: 0,
    title: partial.title ?? "Položka",
    description: "",
    quantity: qty,
    unit: "ks",
    unitPriceNet: unitNet,
    vatRate,
    amountNet,
    vatAmount,
    amountGross,
    itemType: partial.itemType ?? WORK_BUDGET_ITEM_TYPES.NORMAL,
    extraWorkStatus: partial.extraWorkStatus ?? EXTRA_WORK_STATUSES.DRAFT,
    done: partial.done ?? false,
    doneAt: null,
    note: null,
    invoiced: partial.invoiced ?? false,
    invoicedAt: null,
    linkedInvoiceId: partial.linkedInvoiceId ?? null,
  };
}

const jobBudget = {
  vatRate: 21,
  budgetType: "net",
  budgetInput: 1_000_000,
  budgetNet: 1_000_000,
  budgetVat: 210_000,
  budgetGross: 1_210_000,
};

// 1) bez vícepráce
{
  const o = computeWorkBudgetFinancialOverview({ items: [], jobBudget });
  assert.equal(o.currentPrice.net, 1_000_000);
}

// 2) schválená vícepráce +100k net
{
  const extra = item({
    id: "e1",
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.APPROVED,
    amountNet: 100_000,
    vatAmount: 21_000,
    amountGross: 121_000,
  });
  const o = computeWorkBudgetFinancialOverview({ items: [extra], jobBudget });
  assert.equal(o.currentPrice.net, 1_100_000);
}

// 3) návrh vícepráce nemění cenu
{
  const draft = item({
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.DRAFT,
    amountNet: 50_000,
    vatAmount: 10_500,
    amountGross: 60_500,
  });
  const o = computeWorkBudgetFinancialOverview({ items: [draft], jobBudget });
  assert.equal(o.currentPrice.net, 1_000_000);
}

// 4) schválená vícepráce se počítá
{
  const approved = item({
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.APPROVED,
    amountNet: 100_000,
    vatAmount: 21_000,
    amountGross: 121_000,
  });
  const o = computeWorkBudgetFinancialOverview({ items: [approved], jobBudget });
  assert.equal(o.extraWorkApproved.net, 100_000);
}

// 5–6) zálohy v náhledu faktury
{
  const line = item({ id: "l1", done: true, amountNet: 800_000, vatAmount: 168_000, amountGross: 968_000 });
  const adv1 = {
    id: "a1",
    label: "Z1",
    amountGross: 300_000,
    appliedToInvoiceId: null,
    includeInFinalInvoice: true,
    paymentStatus: "paid",
    sourceType: "manual",
    companyId: "c1",
    jobId: "j1",
    invoiceId: null,
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    amountNet: 0,
    vatAmount: 0,
    note: null,
  };
  const adv2 = { ...adv1, id: "a2", label: "Z2", amountGross: 200_000 };
  const preview = buildWorkBudgetInvoicePreview({
    items: [line],
    advances: [adv1, adv2],
    selectedAdvanceIds: ["a1", "a2"],
  });
  assert.equal(preview.deductionGross, 500_000);
  assert.equal(preview.amountGross, 468_000);
}

// 7) stejná záloha dvakrát — appliedToInvoiceId blocks in UI; preview throws if already applied
{
  const line = item({ done: true, amountGross: 100_000, amountNet: 82_645, vatAmount: 17_355 });
  const adv = {
    id: "a1",
    label: "Z",
    amountGross: 50_000,
    appliedToInvoiceId: "inv-old",
    includeInFinalInvoice: true,
    paymentStatus: "paid",
    sourceType: "invoice",
    companyId: "c1",
    jobId: "j1",
    invoiceId: "inv-old",
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    amountNet: 0,
    vatAmount: 0,
    note: null,
  };
  assert.throws(() =>
    buildWorkBudgetInvoicePreview({
      items: [line],
      advances: [adv],
      selectedAdvanceIds: ["a1"],
    })
  );
}

// 8) fakturovaná položka není billable
{
  const rows = [
    item({ id: "1", done: true, invoiced: true, amountNet: 100, vatAmount: 21, amountGross: 121 }),
    item({ id: "2", done: true, invoiced: false, amountNet: 200, vatAmount: 42, amountGross: 242 }),
  ];
  assert.equal(billableWorkBudgetItems(rows).length, 1);
}

// 8b) přegenerování — již fakturovaná položka vázaná na tuto fakturu je znovu billable
{
  const rows = [
    item({
      id: "1",
      done: true,
      invoiced: true,
      linkedInvoiceId: "inv-1",
      amountNet: 100,
      vatAmount: 21,
      amountGross: 121,
    }),
    item({ id: "2", done: true, invoiced: false, amountNet: 200, vatAmount: 42, amountGross: 242 }),
  ];
  assert.equal(workBudgetItemsEligibleForInvoice(rows, "inv-1").length, 2);
  assert.equal(workBudgetItemsEligibleForInvoice(rows, null).length, 1);
}

// 7b) záloha už započtená na stejnou fakturu — při regenerate povoleno
{
  const line = item({
    id: "l1",
    done: true,
    invoiced: true,
    linkedInvoiceId: "inv-1",
    amountGross: 100_000,
    amountNet: 82_645,
    vatAmount: 17_355,
  });
  const adv = {
    id: "a1",
    label: "Z",
    amountGross: 50_000,
    appliedToInvoiceId: "inv-1",
    includeInFinalInvoice: true,
    paymentStatus: "paid",
    sourceType: "invoice",
    companyId: "c1",
    jobId: "j1",
    invoiceId: "inv-1",
    documentNumber: null,
    variableSymbol: null,
    issueDate: null,
    amountNet: 0,
    vatAmount: 0,
    note: null,
  };
  const preview = buildWorkBudgetInvoicePreview({
    items: [line],
    advances: [adv],
    selectedAdvanceIds: ["a1"],
    regenerateInvoiceId: "inv-1",
  });
  assert.equal(preview.deductionGross, 50_000);
  assert.equal(preview.amountGross, 50_000);
}

// 10) stale — změna ceny položky
{
  const invId = "inv-1";
  const budgetRow = item({
    id: "l1",
    done: true,
    invoiced: true,
    linkedInvoiceId: invId,
    amountGross: 121_000,
    amountNet: 100_000,
    vatAmount: 21_000,
  });
  const invoice = {
    id: invId,
    workBudgetSource: true,
    workBudgetItemIds: ["l1"],
    workBudgetAdvanceIds: [],
    workBudgetSubtotalGross: 100_000,
    amountGross: 100_000,
    status: "draft",
    paymentStatus: "unpaid",
  };
  assert.equal(isWorkBudgetInvoiceStale({ invoice, items: [budgetRow], advances: [] }), true);
  const preview = buildWorkBudgetInvoicePreview({
    items: [budgetRow],
    advances: [],
    selectedAdvanceIds: [],
    regenerateInvoiceId: invId,
  });
  const updatedInvoice = {
    ...invoice,
    workBudgetSubtotalGross: preview.subtotalGross,
    amountGross: preview.amountGross,
  };
  assert.equal(
    isWorkBudgetInvoiceStale({ invoice: updatedInvoice, items: [budgetRow], advances: [] }),
    false
  );
}

// 9) zaplacená faktura z rozpočtu — regenerate blocked
{
  const a = assessWorkBudgetInvoiceRegeneration({
    workBudgetSource: true,
    paymentStatus: "paid",
  });
  assert.equal(a.allowed, false);
}

// VÍCEPRÁCE prefix on invoice line description only
{
  const normal = item({ title: "Běžná práce", itemType: WORK_BUDGET_ITEM_TYPES.NORMAL });
  assert.equal(formatWorkBudgetItemInvoiceDescription(normal), "Běžná práce");
  const extra = item({
    title: "Pouzdra na dveře",
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.APPROVED,
  });
  assert.equal(formatWorkBudgetItemInvoiceDescription(extra), "VÍCEPRÁCE – Pouzdra na dveře");
}

// REGENERATE: vícepráce zůstane v názvu řádku; bez dvojitého prefixu
{
  const invId = "inv-1";
  const a = item({
    id: "a",
    title: "Položka A",
    done: true,
    itemType: WORK_BUDGET_ITEM_TYPES.NORMAL,
    amountNet: 100,
    vatAmount: 21,
    amountGross: 121,
  });
  const b = item({
    id: "b",
    title: "Položka B",
    done: true,
    invoiced: true,
    linkedInvoiceId: invId,
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.APPROVED,
    amountNet: 200,
    vatAmount: 42,
    amountGross: 242,
  });
  const c = item({
    id: "c",
    title: "Položka C",
    done: true,
    invoiced: true,
    linkedInvoiceId: invId,
    itemType: WORK_BUDGET_ITEM_TYPES.EXTRA_WORK,
    extraWorkStatus: EXTRA_WORK_STATUSES.APPROVED,
    amountNet: 300,
    vatAmount: 63,
    amountGross: 363,
  });
  let catalog = [a, b, c];
  let billable = workBudgetItemsEligibleForInvoice(catalog, invId);
  let lines = buildInvoiceLinesFromWorkBudgetItems(billable, catalog);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].description, "Položka A");
  assert.equal(lines[1].description, "VÍCEPRÁCE – Položka B");
  assert.equal(lines[2].description, "VÍCEPRÁCE – Položka C");

  catalog = [
    a,
    { ...b, unitPriceNet: 999, amountNet: 999, vatAmount: 210, amountGross: 1209 },
    c,
  ];
  billable = workBudgetItemsEligibleForInvoice(catalog, invId);
  lines = buildInvoiceLinesFromWorkBudgetItems(billable, catalog);
  assert.equal(lines[1].description, "VÍCEPRÁCE – Položka B");
  assert.equal(lines[1].unitPrice, 999);

  catalog = [
    a,
    { ...b, title: "VÍCEPRÁCE – Položka B" },
    c,
  ];
  lines = buildInvoiceLinesFromWorkBudgetItems(
    workBudgetItemsEligibleForInvoice(catalog, invId),
    catalog
  );
  assert.equal(lines[1].description, "VÍCEPRÁCE – Položka B");
  assert.doesNotMatch(lines[1].description, /VÍCEPRÁCE – VÍCEPRÁCE/);
}

// 9) DPH — gross = net + vat v agregaci
{
  const a = item({ amountNet: 100, vatAmount: 21, amountGross: 121 });
  const b = item({ id: "b", amountNet: 200, vatAmount: 42, amountGross: 242 });
  const o = computeWorkBudgetFinancialOverview({
    items: [a, b],
    jobBudget: null,
  });
  assert.equal(o.contractBase.net, 300);
  assert.equal(o.contractBase.gross, 363);
}

{
  const after = applyAdvanceDeductionsToGross({
    subtotalNet: 1000,
    subtotalVat: 210,
    subtotalGross: 1210,
    deductionGross: 210,
  });
  assert.equal(after.gross, 1000);
}

console.log("test-work-budget-financial-logic: OK");
