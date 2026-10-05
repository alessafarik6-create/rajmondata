export function formatBankMoney(n: number | null | undefined, cur: string) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export type BankTxListRow = {
  id: string;
  accountId?: string;
  bookingDate: string;
  direction: string;
  counterpartyName: string | null;
  counterpartyAccount?: string | null;
  variableSymbol: string | null;
  message: string | null;
  amount: number;
  currency: string;
  classification: string;
  matchStatus?: string | null;
  matchedAmountTotal: number;
  suggestedMatches?: { confidence: number; label: string }[] | null;
};
