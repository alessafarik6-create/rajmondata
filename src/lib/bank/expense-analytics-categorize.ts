import type {
  BankExpenseCategory,
  BankExpenseAutoStatus,
  BankMarketingSubcategory,
  BankTransactionDoc,
} from "@/lib/bank/types";

export type BankExpenseRuleDoc = {
  id?: string;
  organizationId: string;
  matchKind: "counterparty_contains" | "counterparty_exact" | "message_contains";
  matchValue: string;
  expenseCategory: BankExpenseCategory;
  marketingSubcategory?: BankMarketingSubcategory | null;
  createdBy?: string;
  createdAt?: unknown;
};

export type ExpenseCategorySuggestion = {
  expenseCategory: BankExpenseCategory;
  marketingSubcategory: BankMarketingSubcategory | null;
  confidence: number;
  status: BankExpenseAutoStatus;
  reason: string;
};

type Pattern = {
  re: RegExp;
  expenseCategory: BankExpenseCategory;
  marketingSubcategory: BankMarketingSubcategory | null;
  confidence: number;
  reason: string;
};

const GLOBAL_PATTERNS: Pattern[] = [
  {
    re: /GOOGLE\s*[\*\.]?\s*ADS|GOOGLEADS|ADS\.GOOGLE/i,
    expenseCategory: "marketing",
    marketingSubcategory: "google_ads",
    confidence: 0.95,
    reason: "Google Ads",
  },
  {
    re: /FACEBK|FACEBOOK|META\s+PLATFORMS|META\s+ADS|INSTAGRAM|FB\.COM\/ADS/i,
    expenseCategory: "marketing",
    marketingSubcategory: "meta_ads",
    confidence: 0.92,
    reason: "Meta / Facebook Ads",
  },
  {
    re: /LINKEDIN\s+ADS|TIKTOK\s+ADS|SEZNAM\.CZ\s+ADS|SKLIK|BING\s+ADS/i,
    expenseCategory: "marketing",
    marketingSubcategory: "other_marketing",
    confidence: 0.85,
    reason: "Ostatní reklama",
  },
  {
    re: /MZD|VÝPLAT|PLAT\s|PLATBA\s+MZD|MPSV|SOCIÁLNÍ\s+POJI/i,
    expenseCategory: "payroll",
    marketingSubcategory: null,
    confidence: 0.8,
    reason: "Mzdy",
  },
  {
    re: /ČEZ|E\.ON|PRE\s|ENERGET| ELEKTŘIN|PLYN\s/i,
    expenseCategory: "energy",
    marketingSubcategory: null,
    confidence: 0.78,
    reason: "Energie",
  },
  {
    re: /ALLIANZ|KOOPERATIVA|GENERALI|POJIŠT|POV\s|HAV\s/i,
    expenseCategory: "insurance",
    marketingSubcategory: null,
    confidence: 0.78,
    reason: "Pojištění",
  },
  {
    re: /ÚČETNI|AUDIT|DANOV/i,
    expenseCategory: "accounting",
    marketingSubcategory: null,
    confidence: 0.75,
    reason: "Účetnictví",
  },
];

function haystack(row: Pick<
  BankTransactionDoc,
  "counterpartyName" | "message" | "reference" | "variableSymbol" | "counterpartyAccount"
>): string {
  return [
    row.counterpartyName,
    row.message,
    row.reference,
    row.variableSymbol,
    row.counterpartyAccount,
  ]
    .map((x) => String(x ?? ""))
    .join(" ")
    .toUpperCase();
}

export function suggestExpenseCategory(
  row: BankTransactionDoc,
  rules: BankExpenseRuleDoc[]
): ExpenseCategorySuggestion | null {
  if (row.direction !== "outgoing" && Number(row.amount) >= 0) {
    return null;
  }
  if (row.classification === "internal_transfer" || row.classification === "ignored") {
    return null;
  }

  const text = haystack(row);
  const cp = String(row.counterpartyName ?? "").trim().toLowerCase();

  for (const rule of rules) {
    const val = rule.matchValue.trim().toLowerCase();
    if (!val) continue;
    if (rule.matchKind === "counterparty_exact" && cp === val) {
      return {
        expenseCategory: rule.expenseCategory,
        marketingSubcategory: rule.marketingSubcategory ?? null,
        confidence: 0.99,
        status: "confirmed",
        reason: `Pravidlo organizace (${rule.matchValue})`,
      };
    }
    if (rule.matchKind === "counterparty_contains" && cp.includes(val)) {
      return {
        expenseCategory: rule.expenseCategory,
        marketingSubcategory: rule.marketingSubcategory ?? null,
        confidence: 0.97,
        status: "confirmed",
        reason: `Pravidlo organizace (${rule.matchValue})`,
      };
    }
    if (rule.matchKind === "message_contains" && text.toLowerCase().includes(val)) {
      return {
        expenseCategory: rule.expenseCategory,
        marketingSubcategory: rule.marketingSubcategory ?? null,
        confidence: 0.96,
        status: "confirmed",
        reason: `Pravidlo organizace (${rule.matchValue})`,
      };
    }
  }

  if (row.expenseCategory && row.expenseAutoStatus === "confirmed") {
    return {
      expenseCategory: row.expenseCategory,
      marketingSubcategory: row.marketingSubcategory ?? null,
      confidence: 1,
      status: "confirmed",
      reason: "Potvrzeno uživatelem",
    };
  }

  if (row.expenseCategory) {
    return {
      expenseCategory: row.expenseCategory,
      marketingSubcategory: row.marketingSubcategory ?? null,
      confidence: 0.9,
      status: "confirmed",
      reason: "Ruční kategorie",
    };
  }

  for (const p of GLOBAL_PATTERNS) {
    if (p.re.test(text)) {
      const status: BankExpenseAutoStatus =
        p.confidence >= 0.9 ? "suggested" : "needs_review";
      return {
        expenseCategory: p.expenseCategory,
        marketingSubcategory: p.marketingSubcategory,
        confidence: p.confidence,
        status,
        reason: p.reason,
      };
    }
  }

  return {
    expenseCategory: "other",
    marketingSubcategory: null,
    confidence: 0.35,
    status: "needs_review",
    reason: "Nezařazeno — vyžaduje kontrolu",
  };
}

export function isInternalTransferCandidate(
  row: BankTransactionDoc,
  ownAccountNumbers: Set<string>
): boolean {
  if (row.classification === "internal_transfer") return true;
  const cp = String(row.counterpartyAccount ?? "").replace(/\s/g, "");
  if (!cp) return false;
  for (const own of ownAccountNumbers) {
    if (own && cp.includes(own.replace(/\s/g, ""))) return true;
  }
  return false;
}
