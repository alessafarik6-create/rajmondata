import { roundMoney2, type JobBudgetBreakdown } from "@/lib/vat-calculations";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import {
  isApprovedExtraWorkItem,
  isExtraWorkItem,
  isNormalBudgetItem,
} from "@/lib/work-budget-types";

export type MoneyTriple = {
  net: number;
  vat: number;
  gross: number;
};

export type WorkBudgetFinancialOverview = {
  contractBase: MoneyTriple;
  extraWorkApproved: MoneyTriple;
  extraWorkPending: MoneyTriple;
  currentPrice: MoneyTriple;
  done: MoneyTriple;
  remaining: MoneyTriple;
  billable: MoneyTriple;
  /** Souhrn pouze schválených víceprací (pro blok Vícepráce). */
  extraWorkAllApproved: MoneyTriple;
};

function emptyTriple(): MoneyTriple {
  return { net: 0, vat: 0, gross: 0 };
}

export function aggregateBudgetItemAmounts(rows: JobWorkBudgetItemDoc[]): MoneyTriple {
  let net = 0;
  let vat = 0;
  let gross = 0;
  for (const row of rows) {
    net += row.amountNet;
    vat += row.vatAmount;
    gross += row.amountGross;
  }
  return {
    net: roundMoney2(net),
    vat: roundMoney2(vat),
    gross: roundMoney2(gross),
  };
}

function jobBudgetToTriple(bd: JobBudgetBreakdown): MoneyTriple {
  return {
    net: bd.budgetNet,
    vat: bd.budgetVat,
    gross: bd.budgetGross,
  };
}

function addTriple(a: MoneyTriple, b: MoneyTriple): MoneyTriple {
  return {
    net: roundMoney2(a.net + b.net),
    vat: roundMoney2(a.vat + b.vat),
    gross: roundMoney2(a.gross + b.gross),
  };
}

function subTriple(a: MoneyTriple, b: MoneyTriple): MoneyTriple {
  return {
    net: roundMoney2(a.net - b.net),
    vat: roundMoney2(a.vat - b.vat),
    gross: roundMoney2(a.gross - b.gross),
  };
}

export function computeWorkBudgetFinancialOverview(params: {
  items: JobWorkBudgetItemDoc[];
  jobBudget: JobBudgetBreakdown | null;
}): WorkBudgetFinancialOverview {
  const { items, jobBudget } = params;
  const normalItems = items.filter(isNormalBudgetItem);
  const extraApproved = items.filter(isApprovedExtraWorkItem);
  const extraPending = items.filter(
    (row) => isExtraWorkItem(row) && !isApprovedExtraWorkItem(row)
  );

  const contractBase: MoneyTriple = jobBudget
    ? jobBudgetToTriple(jobBudget)
    : aggregateBudgetItemAmounts(normalItems);

  const extraWorkApproved = aggregateBudgetItemAmounts(extraApproved);
  const extraWorkPending = aggregateBudgetItemAmounts(extraPending);
  const currentPrice = addTriple(contractBase, extraWorkApproved);

  const doneRows = items.filter((row) => {
    if (row.done !== true) return false;
    if (isExtraWorkItem(row) && !isApprovedExtraWorkItem(row)) return false;
    return true;
  });
  const done = aggregateBudgetItemAmounts(doneRows);
  const remaining = subTriple(currentPrice, done);

  const billableRows = items.filter(
    (row) =>
      row.done &&
      !row.invoiced &&
      row.amountGross > 0 &&
      (!isExtraWorkItem(row) || isApprovedExtraWorkItem(row))
  );
  const billable = aggregateBudgetItemAmounts(billableRows);

  return {
    contractBase,
    extraWorkApproved,
    extraWorkPending,
    extraWorkAllApproved: extraWorkApproved,
    currentPrice,
    done,
    remaining,
    billable,
  };
}

export function applyAdvanceDeductionsToGross(params: {
  subtotalGross: number;
  subtotalNet: number;
  subtotalVat: number;
  deductionGross: number;
}): { net: number; vat: number; gross: number; deductionGross: number } {
  const subGross = Math.max(0, roundMoney2(params.subtotalGross));
  const ded = Math.min(subGross, Math.max(0, roundMoney2(params.deductionGross)));
  if (ded <= 0 || subGross <= 0) {
    return {
      net: roundMoney2(params.subtotalNet),
      vat: roundMoney2(params.subtotalVat),
      gross: subGross,
      deductionGross: 0,
    };
  }
  const ratio = ded / subGross;
  const netDed = roundMoney2(params.subtotalNet * ratio);
  const vatDed = roundMoney2(params.subtotalVat * ratio);
  return {
    net: roundMoney2(params.subtotalNet - netDed),
    vat: roundMoney2(params.subtotalVat - vatDed),
    gross: roundMoney2(subGross - ded),
    deductionGross: ded,
  };
}

export function splitBillableByItemType(items: JobWorkBudgetItemDoc[]): {
  normal: MoneyTriple;
  extraWork: MoneyTriple;
} {
  const billable = items.filter(
    (row) =>
      row.done &&
      !row.invoiced &&
      row.amountGross > 0 &&
      (!isExtraWorkItem(row) || isApprovedExtraWorkItem(row))
  );
  const normal = aggregateBudgetItemAmounts(billable.filter(isNormalBudgetItem));
  const extraWork = aggregateBudgetItemAmounts(
    billable.filter(isApprovedExtraWorkItem)
  );
  return { normal, extraWork };
}
