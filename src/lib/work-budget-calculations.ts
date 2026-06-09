import { roundMoney2 } from "@/lib/vat-calculations";
import type { JobWorkBudgetItemDoc, WorkBudgetSummary } from "@/lib/work-budget-types";

export function computeWorkBudgetSummary(
  items: JobWorkBudgetItemDoc[]
): WorkBudgetSummary {
  let totalNet = 0;
  let totalGross = 0;
  let doneNet = 0;
  let doneGross = 0;
  let billableNet = 0;
  let billableGross = 0;

  for (const row of items) {
    totalNet += row.amountNet;
    totalGross += row.amountGross;
    if (row.done) {
      doneNet += row.amountNet;
      doneGross += row.amountGross;
      if (!row.invoiced) {
        billableNet += row.amountNet;
        billableGross += row.amountGross;
      }
    }
  }

  totalNet = roundMoney2(totalNet);
  totalGross = roundMoney2(totalGross);
  doneNet = roundMoney2(doneNet);
  doneGross = roundMoney2(doneGross);
  billableNet = roundMoney2(billableNet);
  billableGross = roundMoney2(billableGross);

  return {
    totalNet,
    totalGross,
    doneNet,
    doneGross,
    remainingNet: roundMoney2(totalNet - doneNet),
    remainingGross: roundMoney2(totalGross - doneGross),
    billableNet,
    billableGross,
  };
}

export function sortWorkBudgetItems(items: JobWorkBudgetItemDoc[]): JobWorkBudgetItemDoc[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });
}
