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
  /** Nastavení automatické synchronizace, párování a potvrzovacích e-mailů. */
  automation?: BankAutomationSettings | null;
  /** Statistiky posledních automatických běhů (cron / sync). */
  automationStats?: BankAutomationStats | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type BankAutomationSettings = {
  /** Výchozí: true — cron každých 5 hodin. */
  autoSyncEnabled?: boolean;
  /** Výchozí: true — jednoznačné shody bez AI skóre. */
  autoMatchEnabled?: boolean;
  /** Výchozí: false — potvrzení platby e-mailem zákazníkovi. */
  autoPaymentConfirmationEnabled?: boolean;
  /** Účet v modulu E-mail pro odesílání potvrzení. */
  paymentConfirmationEmailAccountId?: string | null;
  /** Výchozí: false — automat u částečných úhrad. */
  autoPartialPaymentConfirmation?: boolean;
  /** Volitelný měsíční e-mail s marketingovými náklady. */
  monthlyMarketingReportEnabled?: boolean;
  /** E-mailové adresy příjemců reportu (oddělené čárkou v UI). */
  monthlyMarketingReportEmails?: string | null;
};

export type BankAutomationStats = {
  lastAutoSyncAt?: string | null;
  nextScheduledSyncAt?: string | null;
  lastAutoMatchAt?: string | null;
  lastRunImported?: number;
  lastRunAutoMatched?: number;
  pendingReviewCount?: number;
  confirmationsSentTotal?: number;
  lastConfirmationSentAt?: string | null;
  lastAutoSyncError?: string | null;
};

export type BankAutomationLogDoc = {
  organizationId: string;
  kind: "sync" | "auto_match" | "payment_confirmation";
  success: boolean;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: unknown;
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

/** UI stav párování (nezávisle na classification pro ruční „ke kontrole“). */
export type BankTransactionMatchStatus = "unmatched" | "review" | "matched";

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
  | "payroll"
  | "material"
  | "operations"
  | "other";

export type BankMarketingSubcategory = "google_ads" | "meta_ads" | "other_marketing";

export type BankExpenseAutoStatus = "suggested" | "confirmed" | "needs_review";

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
  marketingSubcategory?: BankMarketingSubcategory | null;
  expenseAutoStatus?: BankExpenseAutoStatus | null;
  expenseAutoConfidence?: number | null;
  linkedDocumentId?: string | null;
  matchedAmountTotal?: number;
  matchStatus?: BankTransactionMatchStatus | null;
  note?: string | null;
  noteUpdatedAt?: string | null;
  noteUpdatedByUserId?: string | null;
  /** Návrhy z deterministického scoringu — ne finální párování. */
  suggestedMatches?: BankSuggestedMatch[] | null;
  suggestedMatchesAt?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type BankSuggestedMatch = {
  targetKind: BankMatchTargetKind;
  targetId: string;
  label: string;
  variableSymbol?: string | null;
  amount?: number;
  currency?: string;
  confidence: number;
  reasons: string[];
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
  invoicePaymentId?: string | null;
  paymentConfirmationSentAt?: string | null;
  paymentConfirmationEmailAccountId?: string | null;
  paymentConfirmationRecipient?: string | null;
  paymentConfirmationError?: string | null;
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
