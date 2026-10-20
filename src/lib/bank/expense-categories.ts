import type { BankExpenseCategory } from "@/lib/bank/types";

export const BANK_EXPENSE_CATEGORY_OPTIONS: { id: BankExpenseCategory; label: string }[] = [
  { id: "rent", label: "Nájem" },
  { id: "energy", label: "Energie" },
  { id: "phone", label: "Telefon" },
  { id: "internet", label: "Internet" },
  { id: "fuel", label: "PHM" },
  { id: "software", label: "Software" },
  { id: "accounting", label: "Účetnictví" },
  { id: "insurance", label: "Pojištění" },
  { id: "marketing", label: "Marketing" },
  { id: "payroll", label: "Mzdy" },
  { id: "material", label: "Materiál" },
  { id: "operations", label: "Provozní náklady" },
  { id: "other", label: "Ostatní" },
];

export const BANK_MARKETING_SUBCATEGORY_OPTIONS: {
  id: import("@/lib/bank/types").BankMarketingSubcategory;
  label: string;
}[] = [
  { id: "google_ads", label: "Google Ads" },
  { id: "meta_ads", label: "Facebook / Meta Ads" },
  { id: "other_marketing", label: "Ostatní reklama" },
];

export function bankMarketingSubcategoryLabel(
  id: import("@/lib/bank/types").BankMarketingSubcategory | null | undefined
): string {
  const hit = BANK_MARKETING_SUBCATEGORY_OPTIONS.find((o) => o.id === id);
  return hit?.label ?? "—";
}

export function bankExpenseCategoryLabel(id: BankExpenseCategory | null | undefined): string {
  const hit = BANK_EXPENSE_CATEGORY_OPTIONS.find((o) => o.id === id);
  return hit?.label ?? "—";
}
