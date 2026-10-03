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
  { id: "other", label: "Ostatní" },
];

export function bankExpenseCategoryLabel(id: BankExpenseCategory | null | undefined): string {
  const hit = BANK_EXPENSE_CATEGORY_OPTIONS.find((o) => o.id === id);
  return hit?.label ?? "—";
}
