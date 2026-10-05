import type { BankSuggestedMatch, BankTransactionMatchStatus } from "@/lib/bank/types";

export type BankMatchUiState = "matched" | "unmatched" | "review";

export function resolveBankMatchUiState(input: {
  classification: string;
  matchedAmountTotal?: number;
  amount: number;
  matchStatus?: BankTransactionMatchStatus | null;
  suggestedMatches?: BankSuggestedMatch[] | null;
}): BankMatchUiState {
  if (input.matchStatus === "review") return "review";
  if (input.matchStatus === "matched" || input.classification === "matched") return "matched";
  const txnAbs = Math.abs(Number(input.amount));
  const matched = Number(input.matchedAmountTotal ?? 0);
  if (matched > 0 && matched < txnAbs - 0.009) return "review";
  if (input.classification === "matched") return "matched";
  return "unmatched";
}

export function confidenceBand(confidence: number): string {
  if (confidence >= 90) return "Velmi pravděpodobná shoda";
  if (confidence >= 70) return "Pravděpodobná shoda";
  if (confidence >= 40) return "Možná shoda";
  return "Slabá shoda";
}

export function topSuggestedMatch(
  suggestions?: BankSuggestedMatch[] | null
): BankSuggestedMatch | null {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;
  return [...suggestions].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

export function aiMatchSummary(
  suggestions: BankSuggestedMatch[],
  direction: "incoming" | "outgoing"
): string | null {
  const top = suggestions[0];
  if (!top) return null;
  const kind = direction === "incoming" ? "vydanou fakturou" : "přijatým dokladem";
  const reasons = top.reasons.slice(0, 3).join(", ");
  return `Pravděpodobná shoda s ${kind} ${top.label} (${top.confidence} %). ${reasons}.`;
}
