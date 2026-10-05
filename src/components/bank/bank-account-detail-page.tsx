"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Landmark } from "lucide-react";
import { BankTransactionsTable } from "@/components/bank/bank-transactions-table";
import { BankTransactionDrawer } from "@/components/bank/bank-transaction-drawer";
import { formatBankMoney, type BankTxListRow } from "@/components/bank/bank-utils";
import { downloadCsvFromRows } from "@/lib/csv-download";
import { resolveBankMatchUiState } from "@/lib/bank/match-display";

export function BankAccountDetailPage({ accountId }: { accountId: string }) {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("bank");
  const [account, setAccount] = useState<{
    name: string | null;
    accountNumber: string | null;
    currency: string;
    balance: number | null;
    availableBalance: number | null;
    lastSyncAt: string | null;
  } | null>(null);
  const [transactions, setTransactions] = useState<BankTxListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQ, setFilterQ] = useState("");
  const [filterVs, setFilterVs] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [direction, setDirection] = useState("");
  const [matchState, setMatchState] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [drawerTxn, setDrawerTxn] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const token = await user!.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [user]);

  const load = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const accRes = await fetch(
        `/api/company/bank/accounts/${encodeURIComponent(accountId)}?companyId=${encodeURIComponent(companyId)}`,
        { headers }
      );
      const accJson = await accRes.json();
      if (accJson.ok) setAccount(accJson.account);

      const params = new URLSearchParams({
        companyId,
        limit: "500",
        accountId,
      });
      if (filterQ) params.set("q", filterQ);
      if (filterVs) params.set("variableSymbol", filterVs);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (direction) params.set("direction", direction);
      if (matchState) params.set("matchState", matchState);
      if (amountMin) params.set("amountMin", amountMin);
      if (amountMax) params.set("amountMax", amountMax);

      const txRes = await fetch(`/api/company/bank/transactions?${params}`, { headers });
      const txJson = await txRes.json();
      if (txJson.ok) setTransactions(txJson.transactions ?? []);
    } finally {
      setLoading(false);
    }
  }, [
    user,
    companyId,
    access.canRead,
    accountId,
    authHeaders,
    filterQ,
    filterVs,
    dateFrom,
    dateTo,
    direction,
    matchState,
    amountMin,
    amountMax,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const unmatchedCount = useMemo(
    () =>
      transactions.filter(
        (t) =>
          resolveBankMatchUiState({
            classification: t.classification,
            matchedAmountTotal: t.matchedAmountTotal,
            amount: t.amount,
            matchStatus: t.matchStatus as "unmatched" | "review" | "matched" | null,
            suggestedMatches: t.suggestedMatches as import("@/lib/bank/types").BankSuggestedMatch[] | null,
          }) === "unmatched"
      ).length,
    [transactions]
  );

  const exportCsv = () => {
    const rows: string[][] = [
      ["Datum", "Typ", "Protistrana", "VS", "Popis", "Částka", "Měna"],
      ...transactions.map((t) => [
        t.bookingDate,
        t.direction === "incoming" ? "Příchozí" : "Odchozí",
        t.counterpartyName ?? "",
        t.variableSymbol ?? "",
        t.message ?? "",
        String(t.amount),
        t.currency,
      ]),
    ];
    downloadCsvFromRows(rows, `banka-ucet-${accountId}.csv`);
  };

  if (!access.canRead) {
    return <p className="p-6 text-muted-foreground">Nemáte oprávnění k modulu Banka.</p>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/bank">
            <ArrowLeft className="mr-1 h-4 w-4" /> Banka
          </Link>
        </Button>
        <Landmark className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Detail účtu</h1>
      </div>

      {loading && !account ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{account?.name ?? account?.accountNumber ?? accountId}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Číslo účtu: </span>
                {account?.accountNumber ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Měna: </span>
                {account?.currency ?? "CZK"}
              </p>
              <p>
                <span className="text-muted-foreground">Zůstatek: </span>
                {formatBankMoney(account?.balance ?? null, account?.currency ?? "CZK")}
              </p>
              <p>
                <span className="text-muted-foreground">Disponibilní: </span>
                {formatBankMoney(
                  account?.availableBalance ?? account?.balance ?? null,
                  account?.currency ?? "CZK"
                )}
              </p>
              <p className="md:col-span-2">
                <span className="text-muted-foreground">Poslední synchronizace: </span>
                {account?.lastSyncAt
                  ? new Date(account.lastSyncAt).toLocaleString("cs-CZ")
                  : "—"}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium">Transakce účtu</h2>
              <span className="text-sm text-muted-foreground">Nespárované: {unmatchedCount}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              <select
                className="rounded-md border px-2 py-2 text-sm"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="">Směr</option>
                <option value="incoming">Příchozí</option>
                <option value="outgoing">Odchozí</option>
              </select>
              <select
                className="rounded-md border px-2 py-2 text-sm"
                value={matchState}
                onChange={(e) => setMatchState(e.target.value)}
              >
                <option value="">Stav</option>
                <option value="unmatched">Nespárované</option>
                <option value="review">Ke kontrole</option>
                <option value="matched">Spárováno</option>
              </select>
              <Input placeholder="Fulltext" value={filterQ} onChange={(e) => setFilterQ(e.target.value)} className="max-w-xs" />
              <Input placeholder="VS" value={filterVs} onChange={(e) => setFilterVs(e.target.value)} className="max-w-[120px]" />
              <Input placeholder="Částka od" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className="max-w-[100px]" />
              <Input placeholder="do" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className="max-w-[100px]" />
              <Button variant="outline" onClick={() => void load()}>
                Filtrovat
              </Button>
              <Button variant="outline" onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
            <BankTransactionsTable
              rows={transactions}
              onOpenTransaction={(id) => setDrawerTxn(id)}
              showMatchAction={access.canWrite}
            />
          </div>
        </>
      )}

      {companyId && user ? (
        <BankTransactionDrawer
          open={!!drawerTxn}
          onOpenChange={(v) => !v && setDrawerTxn(null)}
          transactionId={drawerTxn}
          companyId={companyId}
          canWrite={access.canWrite}
          getAuthHeaders={authHeaders}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
