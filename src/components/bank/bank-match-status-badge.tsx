"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveBankMatchUiState, topSuggestedMatch } from "@/lib/bank/match-display";
import type { BankSuggestedMatch } from "@/lib/bank/types";

export function BankMatchStatusBadge(props: {
  classification: string;
  matchedAmountTotal?: number;
  amount: number;
  matchStatus?: string | null;
  suggestedMatches?: BankSuggestedMatch[] | null;
  compact?: boolean;
}) {
  const state = resolveBankMatchUiState({
    classification: props.classification,
    matchedAmountTotal: props.matchedAmountTotal,
    amount: props.amount,
    matchStatus: props.matchStatus as "unmatched" | "review" | "matched" | null,
    suggestedMatches: props.suggestedMatches,
  });
  const top = topSuggestedMatch(props.suggestedMatches);

  if (state === "matched") {
    return (
      <Badge variant="default" className="bg-emerald-700 hover:bg-emerald-700">
        {props.compact ? "✓" : "✓ Spárováno"}
      </Badge>
    );
  }
  if (state === "review") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="border-amber-500 text-amber-800">
              {props.compact ? "!" : "! Ke kontrole"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            Částečně spárováno nebo vyžaduje ruční kontrolu.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 border-amber-600 text-amber-900">
            <span aria-hidden>?</span>
            {props.compact ? null : " Nespárováno"}
            {top && top.confidence >= 40 ? (
              <span className="text-xs text-muted-foreground">AI {top.confidence} %</span>
            ) : null}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Tato bankovní transakce zatím není přiřazena k faktuře ani dokladu.
          {top ? ` Návrh: ${top.label} (${top.confidence} %).` : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
