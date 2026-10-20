import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { bankAccountsCol, bankExpenseRulesCol, bankTransactionsCol } from "@/lib/bank/collections";
import {
  bankDatePresetRange,
  parseBankTransactionFilterFromSearchParams,
} from "@/lib/bank/transaction-query";
import type { BankTransactionDoc } from "@/lib/bank/types";
import { buildExpenseAnalytics, type ExpenseAnalyticsFilters } from "@/lib/bank/expense-analytics-aggregate";
import type { BankExpenseRuleDoc } from "@/lib/bank/expense-analytics-categorize";

export async function loadExpenseAnalyticsForOrganization(
  db: Firestore,
  organizationId: string,
  sp: URLSearchParams
) {
  let baseFilter = parseBankTransactionFilterFromSearchParams(sp);
  const preset = sp.get("datePreset");
  if (preset) {
    const today = new Date().toISOString().split("T")[0];
    const range = bankDatePresetRange(preset, today);
    if (range) baseFilter = { ...baseFilter, ...range };
  }

  const filter: ExpenseAnalyticsFilters = {
    ...baseFilter,
    direction: "outgoing",
    expenseCategory: sp.get("expenseCategory"),
    marketingChannel: (sp.get("marketingChannel") as ExpenseAnalyticsFilters["marketingChannel"]) || null,
    needsReviewOnly: sp.get("needsReviewOnly") === "1",
  };

  const limit = Math.min(3000, Math.max(100, Number(sp.get("limit") ?? 1500) || 1500));
  const snap = await bankTransactionsCol(db, organizationId)
    .orderBy("bookingDate", "desc")
    .limit(limit)
    .get();

  const rulesSnap = await bankExpenseRulesCol(db, organizationId).limit(200).get();
  const rules: BankExpenseRuleDoc[] = rulesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as BankExpenseRuleDoc),
  }));

  const accountsSnap = await bankAccountsCol(db, organizationId).get();
  const ownAccounts = new Set<string>();
  for (const a of accountsSnap.docs) {
    const d = a.data();
    if (d.accountNumber) ownAccounts.add(String(d.accountNumber));
    if (d.iban) ownAccounts.add(String(d.iban));
  }

  const transactions = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as BankTransactionDoc),
  }));

  return buildExpenseAnalytics(transactions, rules, ownAccounts, filter);
}
