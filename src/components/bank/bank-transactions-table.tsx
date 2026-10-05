"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BankMatchStatusBadge } from "@/components/bank/bank-match-status-badge";
import { formatBankMoney, type BankTxListRow } from "@/components/bank/bank-utils";
import type { BankSuggestedMatch } from "@/lib/bank/types";

export function BankTransactionsTable({
  rows,
  onOpenTransaction,
  showMatchAction,
}: {
  rows: BankTxListRow[];
  onOpenTransaction: (id: string) => void;
  showMatchAction?: boolean;
}) {
  return (
    <>
      <div className="md:hidden space-y-2">
        {rows.map((t) => (
          <Card
            key={t.id}
            className="cursor-pointer transition hover:border-primary/40"
            onClick={() => onOpenTransaction(t.id)}
          >
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t.bookingDate}</span>
                <Badge variant={t.direction === "incoming" ? "default" : "secondary"}>
                  {t.direction === "incoming" ? "Příchozí" : "Odchozí"}
                </Badge>
              </div>
              <div
                className={`text-lg font-semibold ${t.amount >= 0 ? "text-emerald-700" : ""}`}
              >
                {formatBankMoney(t.amount, t.currency)}
              </div>
              <p className="text-sm text-muted-foreground truncate">{t.message ?? t.counterpartyName ?? "—"}</p>
              <BankMatchStatusBadge
                classification={t.classification}
                matchedAmountTotal={t.matchedAmountTotal}
                amount={t.amount}
                matchStatus={t.matchStatus}
                suggestedMatches={t.suggestedMatches as BankSuggestedMatch[] | null}
                compact
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Protistrana</TableHead>
                <TableHead>VS</TableHead>
                <TableHead>Popis</TableHead>
                <TableHead>Částka</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onOpenTransaction(t.id)}
                >
                  <TableCell>{t.bookingDate}</TableCell>
                  <TableCell>
                    <Badge variant={t.direction === "incoming" ? "default" : "secondary"}>
                      {t.direction === "incoming" ? "Příchozí" : "Odchozí"}
                    </Badge>
                  </TableCell>
                  <TableCell>{t.counterpartyName ?? "—"}</TableCell>
                  <TableCell>{t.variableSymbol ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{t.message ?? "—"}</TableCell>
                  <TableCell className={t.amount >= 0 ? "text-emerald-700 font-medium" : ""}>
                    {formatBankMoney(t.amount, t.currency)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <BankMatchStatusBadge
                      classification={t.classification}
                      matchedAmountTotal={t.matchedAmountTotal}
                      amount={t.amount}
                      matchStatus={t.matchStatus}
                      suggestedMatches={t.suggestedMatches as BankSuggestedMatch[] | null}
                    />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {showMatchAction ? (
                      <Button size="sm" variant="ghost" onClick={() => onOpenTransaction(t.id)}>
                        Spárovat
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

export function BankAccountRowLink({
  accountId,
  children,
  className,
}: {
  accountId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={`/portal/bank/accounts/${encodeURIComponent(accountId)}`} className={className}>
      {children}
    </Link>
  );
}
