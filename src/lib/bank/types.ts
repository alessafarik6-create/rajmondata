export const BANK_PROVIDER_RAIFFEISEN = "raiffeisenbank" as const;

export type BankProvider = typeof BANK_PROVIDER_RAIFFEISEN;

export type BankConnectionStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "syncing"
  | "auth_error";

export type BankConnectionDoc = {
  organizationId: string;
  provider: BankProvider;
  clientId: string;
  /** AES-GCM šifrovaný base64 (.p12). Nikdy neposílat do klienta. */
  encryptedCertificate?: string | null;
  /** AES-GCM šifrované heslo certifikátu. */
  encryptedCertificatePassword?: string | null;
  status: BankConnectionStatus;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  lastSyncStats?: {
    accounts?: number;
    imported?: number;
    updated?: number;
  } | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type BankAccountDoc = {
  organizationId: string;
  connectionId: string;
  externalAccountId: string;
  accountNumber?: string | null;
  iban?: string | null;
  currency: string;
  name?: string | null;
  balance?: number | null;
  availableBalance?: number | null;
  isActive: boolean;
  updatedAt?: unknown;
};

export type BankTransactionDirection = "incoming" | "outgoing";

export type BankTransactionClassification =
  | "unmatched"
  | "matched"
  | "internal_transfer"
  | "expense"
  | "other_income"
  | "ignored";

export type BankExpenseCategory =
  | "rent"
  | "energy"
  | "phone"
  | "internet"
  | "fuel"
  | "software"
  | "accounting"
  | "insurance"
  | "marketing"
  | "other";

export type BankTransactionDoc = {
  organizationId: string;
  accountId: string;
  externalTransactionId: string;
  rawHash: string;
  bookingDate: string;
  valueDate?: string | null;
  amount: number;
  currency: string;
  direction: BankTransactionDirection;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  variableSymbol?: string | null;
  constantSymbol?: string | null;
  specificSymbol?: string | null;
  message?: string | null;
  reference?: string | null;
  classification: BankTransactionClassification;
  expenseCategory?: BankExpenseCategory | null;
  linkedDocumentId?: string | null;
  matchedAmountTotal?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type BankMatchType = "auto" | "manual" | "confirmed_auto";

export type BankTransactionMatchDoc = {
  organizationId: string;
  transactionId: string;
  invoiceId?: string | null;
  documentId?: string | null;
  matchedAmount: number;
  matchedBy: string;
  matchedAt: string;
  matchType: BankMatchType;
  confidence?: number | null;
  createdAt?: unknown;
};

export type BankMatchTargetKind = "issued_invoice" | "received_document";

export type BankMatchSuggestion = {
  targetKind: BankMatchTargetKind;
  targetId: string;
  label: string;
  variableSymbol?: string | null;
  amount: number;
  currency: string;
  confidence: number;
  reasons: string[];
};
