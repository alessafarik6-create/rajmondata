import { roundMoney2 } from "@/lib/vat-calculations";

export function formatBankMoneyCs(amount: number, currency: string): string {
  const n = roundMoney2(amount);
  const cur = String(currency ?? "CZK").toUpperCase();
  const formatted = new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
  return `${formatted} ${cur === "CZK" ? "Kč" : cur}`;
}
