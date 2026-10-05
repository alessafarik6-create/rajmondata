import type { RaiffeisenAccountDto, RaiffeisenTransactionDto } from "@/lib/bank/raiffeisen-client";
import { logRbAccountRawFields } from "@/lib/bank/rb-premium-http";

function logRbAccountRowFields(a: RbAccountRow): void {
  logRbAccountRawFields(a as Record<string, unknown>);
}

type RbAccountRow = {
  accountId?: number | string;
  accountNumber?: string;
  accountNumberPrefix?: string | null;
  iban?: string | null;
  mainCurrency?: string | null;
  accountName?: string | null;
  friendlyName?: string | null;
};

type RbAccountsPage = {
  accounts?: RbAccountRow[];
  last?: boolean;
  page?: number;
  totalSize?: number;
};

export function mapRbAccountRow(a: RbAccountRow): RaiffeisenAccountDto | null {
  logRbAccountRowFields(a);
  const accountNumber = String(a.accountNumber ?? "").replace(/\D/g, "").trim();
  const rbAccountId = a.accountId != null ? String(a.accountId) : "";
  if (!accountNumber && !rbAccountId) return null;
  if (!accountNumber) {
    console.warn("[RB ACCOUNT] missing accountNumber for RB path; accountId only", {
      accountIdSuffix: rbAccountId.slice(-4),
    });
  }

  const prefix = String(a.accountNumberPrefix ?? "").trim();
  const displayNumber =
    prefix && accountNumber ? `${prefix}-${accountNumber}` : accountNumber || null;

  return {
    externalAccountId: rbAccountId || accountNumber,
    accountNumber: displayNumber,
    iban: a.iban ?? null,
    currency: String(a.mainCurrency ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3) || "CZK",
    name: (a.friendlyName ?? a.accountName ?? null)?.trim() || null,
    balance: null,
    availableBalance: null,
    /** RB path param — číslo účtu bez prefixu */
    rbAccountNumber: accountNumber || null,
  };
}

export function parseRbAccountsPayload(data: unknown): RbAccountsPage {
  if (Array.isArray(data)) {
    return { accounts: data as RbAccountRow[], last: true };
  }
  const obj = data as RbAccountsPage;
  return {
    accounts: Array.isArray(obj.accounts) ? obj.accounts : [],
    last: obj.last ?? true,
    page: obj.page,
    totalSize: obj.totalSize,
  };
}

function isoDateOnly(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

type RbTxnRow = {
  entryReference?: string | number;
  amount?: { value?: number; currency?: string };
  creditDebitIndication?: string;
  bookingDate?: string;
  valueDate?: string;
  entryDetails?: {
    transactionDetails?: {
      remittanceInformation?: {
        unstructured?: string;
        creditorReferenceInformation?: {
          variable?: string;
          constant?: string;
          specific?: string;
        };
        originatorMessage?: string;
      };
      relatedParties?: {
        counterParty?: {
          name?: string;
          account?: { identification?: { iban?: string; other?: { identification?: string } } };
        };
      };
    };
  };
};

export function mapRbTransactionRow(row: RbTxnRow, defaultCurrency: string): RaiffeisenTransactionDto | null {
  const amountRaw = row.amount?.value;
  if (amountRaw == null || !Number.isFinite(Number(amountRaw))) return null;
  let amount = Number(amountRaw);
  const ind = String(row.creditDebitIndication ?? "").toUpperCase();
  if (ind === "CRDT" && amount < 0) amount = Math.abs(amount);
  if (ind === "DBIT" && amount > 0) amount = -Math.abs(amount);

  const bookingDate =
    isoDateOnly(row.bookingDate) ?? isoDateOnly(row.valueDate) ?? new Date().toISOString().slice(0, 10);

  const rem = row.entryDetails?.transactionDetails?.remittanceInformation;
  const cp = row.entryDetails?.transactionDetails?.relatedParties?.counterParty;

  return {
    externalTransactionId: row.entryReference != null ? String(row.entryReference) : null,
    bookingDate,
    valueDate: isoDateOnly(row.valueDate),
    amount,
    currency: String(row.amount?.currency ?? defaultCurrency).toUpperCase(),
    counterpartyName: cp?.name?.trim() || null,
    counterpartyAccount:
      cp?.account?.identification?.iban ??
      cp?.account?.identification?.other?.identification ??
      null,
    variableSymbol: rem?.creditorReferenceInformation?.variable ?? null,
    constantSymbol: rem?.creditorReferenceInformation?.constant ?? null,
    specificSymbol: rem?.creditorReferenceInformation?.specific ?? null,
    message: rem?.unstructured ?? rem?.originatorMessage ?? null,
    reference: row.entryReference != null ? String(row.entryReference) : null,
  };
}

export function parseRbTransactionsPayload(data: unknown): {
  transactions: RbTxnRow[];
  lastPage: boolean;
} {
  const obj = data as { transactions?: RbTxnRow[]; lastPage?: boolean };
  const transactions = Array.isArray(obj.transactions) ? obj.transactions : [];
  return {
    transactions,
    lastPage: obj.lastPage === true || transactions.length === 0,
  };
}

type RbBalanceFolder = {
  currency?: string;
  balances?: { balanceType?: string; value?: number; currency?: string }[];
};

export function mapRbBalanceForCurrency(
  payload: unknown,
  currencyCode: string
): { balance: number | null; availableBalance: number | null } {
  const obj = payload as { currencyFolders?: RbBalanceFolder[] };
  const folders = Array.isArray(obj.currencyFolders) ? obj.currencyFolders : [];
  const cur = currencyCode.toUpperCase();
  const folder = folders.find((f) => String(f.currency ?? "").toUpperCase() === cur) ?? folders[0];
  if (!folder?.balances?.length) return { balance: null, availableBalance: null };

  let balance: number | null = null;
  let availableBalance: number | null = null;
  for (const b of folder.balances) {
    const type = String(b.balanceType ?? "").toUpperCase();
    const val = b.value;
    if (val == null || !Number.isFinite(Number(val))) continue;
    if (type === "CLAB" || type === "CLBD") balance = Number(val);
    if (type === "CLAV" || type === "FWAV") availableBalance = Number(val);
  }
  if (balance == null && folder.balances[0]?.value != null) {
    balance = Number(folder.balances[0].value);
  }
  return { balance, availableBalance };
}
