import { roundMoney2, type JobBudgetBreakdown } from "@/lib/vat-calculations";
import type { JobWorkBudgetItemDoc, WorkBudgetSummary } from "@/lib/work-budget-types";
import { computeWorkBudgetFinancialOverview } from "@/lib/work-budget-financial-overview";

export function computeWorkBudgetSummary(
  items: JobWorkBudgetItemDoc[],
  jobBudget?: JobBudgetBreakdown | null
): WorkBudgetSummary {
  const overview = computeWorkBudgetFinancialOverview({
    items,
    jobBudget: jobBudget ?? null,
  });

  return {
    totalNet: overview.currentPrice.net,
    totalGross: overview.currentPrice.gross,
    contractBaseNet: overview.contractBase.net,
    contractBaseGross: overview.contractBase.gross,
    extraWorkApprovedNet: overview.extraWorkApproved.net,
    extraWorkApprovedGross: overview.extraWorkApproved.gross,
    doneNet: overview.done.net,
    doneGross: overview.done.gross,
    remainingNet: overview.remaining.net,
    remainingGross: overview.remaining.gross,
    billableNet: overview.billable.net,
    billableGross: overview.billable.gross,
  };
}

export function sortWorkBudgetItems(items: JobWorkBudgetItemDoc[]): JobWorkBudgetItemDoc[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });
}
