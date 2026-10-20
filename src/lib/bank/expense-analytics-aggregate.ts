import type { BankTransactionDoc } from "@/lib/bank/types";
import type { BankTransactionFilter } from "@/lib/bank/transaction-query";
import { bankTransactionMatchesFilter } from "@/lib/bank/transaction-query";
import {
  isInternalTransferCandidate,
  suggestExpenseCategory,
  type BankExpenseRuleDoc,
} from "@/lib/bank/expense-analytics-categorize";
import { bankExpenseCategoryLabel, bankMarketingSubcategoryLabel } from "@/lib/bank/expense-categories";

export type ExpenseAnalyticsRow = BankTransactionDoc & {
  id: string;
  effectiveCategory: string;
  effectiveMarketingSubcategory: import("@/lib/bank/types").BankMarketingSubcategory | null;
  effectiveCategoryLabel: string;
  marketingSubcategoryLabel: string;
  expenseAbsCzk: number;
  isRefund: boolean;
  needsReview: boolean;
  suggestionReason: string;
};

export type ExpenseAnalyticsSummary = {
  totalOutgoing: number;
  totalMarketing: number;
  googleAds: number;
  metaAds: number;
  otherMarketing: number;
  payroll: number;
  material: number;
  energy: number;
  insurance: number;
  operations: number;
  other: number;
  refundsTotal: number;
  netExpenses: number;
  needsReviewCount: number;
  currencyNote: string;
};

export type ExpenseAnalyticsFilters = BankTransactionFilter & {
  expenseCategory?: string | null;
  marketingChannel?: "google_ads" | "meta_ads" | "other_marketing" | "all_marketing" | null;
  needsReviewOnly?: boolean;
};

function monthKey(bookingDate: string): string {
  return String(bookingDate ?? "").slice(0, 7);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pro CZK agregaci — jiné měny zahrneme s označením v currencyNote. */
function amountInCzk(row: BankTransactionDoc): number {
  const abs = Math.abs(Number(row.amount));
  if (String(row.currency).toUpperCase() === "CZK") return abs;
  return abs;
}

export function buildExpenseAnalytics(
  transactions: (BankTransactionDoc & { id: string })[],
  rules: BankExpenseRuleDoc[],
  ownAccountNumbers: Set<string>,
  filter: ExpenseAnalyticsFilters
): {
  rows: ExpenseAnalyticsRow[];
  summary: ExpenseAnalyticsSummary;
  monthly: { month: string; marketing: number; google: number; meta: number; total: number }[];
  marketingComparison: { google: number; meta: number; other: number };
} {
  const enriched: ExpenseAnalyticsRow[] = [];

  for (const t of transactions) {
    if (!bankTransactionMatchesFilter(t, filter)) continue;
    if (isInternalTransferCandidate(t, ownAccountNumbers)) continue;

    const isRefund =
      t.direction === "incoming" &&
      (t.classification === "expense" ||
        suggestExpenseCategory({ ...t, direction: "outgoing", amount: -Math.abs(t.amount) }, rules)
          ?.expenseCategory === "marketing");

    const outgoing = t.direction === "outgoing" || Number(t.amount) < 0;
    if (!outgoing && !isRefund) continue;

    const suggestion = suggestExpenseCategory(t, rules);
    const cat = suggestion?.expenseCategory ?? "other";
    const msub = suggestion?.marketingSubcategory ?? null;

    if (filter.expenseCategory && cat !== filter.expenseCategory) continue;
    if (filter.marketingChannel === "google_ads" && msub !== "google_ads") continue;
    if (filter.marketingChannel === "meta_ads" && msub !== "meta_ads") continue;
    if (filter.marketingChannel === "other_marketing" && msub !== "other_marketing") continue;
    if (filter.marketingChannel === "all_marketing" && cat !== "marketing") continue;
    if (filter.needsReviewOnly && suggestion?.status !== "needs_review") continue;

    enriched.push({
      ...t,
      effectiveCategory: cat,
      effectiveMarketingSubcategory: msub,
      effectiveCategoryLabel: bankExpenseCategoryLabel(cat),
      marketingSubcategoryLabel: msub ? bankMarketingSubcategoryLabel(msub) : "—",
      expenseAbsCzk: amountInCzk(t),
      isRefund,
      needsReview: suggestion?.status === "needs_review",
      suggestionReason: suggestion?.reason ?? "",
    });
  }

  const summary: ExpenseAnalyticsSummary = {
    totalOutgoing: 0,
    totalMarketing: 0,
    googleAds: 0,
    metaAds: 0,
    otherMarketing: 0,
    payroll: 0,
    material: 0,
    energy: 0,
    insurance: 0,
    operations: 0,
    other: 0,
    refundsTotal: 0,
    netExpenses: 0,
    needsReviewCount: 0,
    currencyNote: "Součty v CZK u transakcí v CZK; ostatní měny v nominální hodnotě bez přepočtu kurzu.",
  };

  const monthlyMap = new Map<string, { marketing: number; google: number; meta: number; total: number }>();

  for (const r of enriched) {
    const sign = r.isRefund ? -1 : 1;
    const amt = round2(r.expenseAbsCzk * sign);
    if (r.isRefund) {
      summary.refundsTotal += r.expenseAbsCzk;
    } else {
      summary.totalOutgoing += r.expenseAbsCzk;
    }

    const cat = r.effectiveCategory;
    if (cat === "marketing") summary.totalMarketing += amt;
    if (r.effectiveMarketingSubcategory === "google_ads") summary.googleAds += amt;
    else if (r.effectiveMarketingSubcategory === "meta_ads") summary.metaAds += amt;
    else if (cat === "marketing") summary.otherMarketing += amt;

    if (cat === "payroll") summary.payroll += amt;
    if (cat === "material") summary.material += amt;
    if (cat === "energy") summary.energy += amt;
    if (cat === "insurance") summary.insurance += amt;
    if (cat === "operations") summary.operations += amt;
    if (cat === "other") summary.other += amt;

    if (r.needsReview) summary.needsReviewCount++;

    const mk = monthKey(r.bookingDate);
    const bucket = monthlyMap.get(mk) ?? { marketing: 0, google: 0, meta: 0, total: 0 };
    if (!r.isRefund) bucket.total += r.expenseAbsCzk;
    if (cat === "marketing") {
      bucket.marketing += amt;
      if (r.effectiveMarketingSubcategory === "google_ads") bucket.google += amt;
      else if (r.effectiveMarketingSubcategory === "meta_ads") bucket.meta += amt;
    }
    monthlyMap.set(mk, bucket);
  }

  summary.netExpenses = round2(summary.totalOutgoing - summary.refundsTotal);
  for (const k of Object.keys(summary) as (keyof ExpenseAnalyticsSummary)[]) {
    if (typeof summary[k] === "number" && k !== "needsReviewCount") {
      (summary[k] as number) = round2(summary[k] as number);
    }
  }

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  return {
    rows: enriched,
    summary,
    monthly,
    marketingComparison: {
      google: summary.googleAds,
      meta: summary.metaAds,
      other: summary.otherMarketing,
    },
  };
}

export function pct(part: number, total: number): number {
  if (!total || !Number.isFinite(total)) return 0;
  return round2((part / total) * 100);
}
